/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Extension Entry Point.
 * Activated early (onStartupFinished) to register the auth provider before Copilot.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { MacideGitHubAuthProvider } from './auth/provider';
import { AccountManager } from './accounts/manager';
import { AccountTracker } from './accounts/tracker';
import { AccountRotator } from './auth/rotator';
import { NotificationService } from './ui/notifications/notificationService';
import { CredentialBridge } from './auth/credentialBridge';
import { installHttpInterceptor, uninstallHttpInterceptor } from './auth/httpInterceptor';
import { AccountPanelProvider } from './ui/accountPanel/accountPanelProvider';
import { AccountStatusBar } from './ui/statusbar/accountStatusBar';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	// --- Core services ---
	const notifications = new NotificationService();
	const accountManager = new AccountManager(context);
	await accountManager.load();

	const rotator = new AccountRotator(accountManager, notifications);
	const tracker = new AccountTracker(accountManager, rotator);
	const credentialBridge = new CredentialBridge(accountManager, notifications);

	// --- Auth Provider ---
	// Registered with ID 'github' so it intercepts Copilot's auth requests.
	const authProvider = new MacideGitHubAuthProvider(context, accountManager);
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			'github',
			'GitHub (Macide)',
			authProvider,
			{ supportsMultipleAccounts: false }
		)
	);

	// --- HTTP Interceptor ---
	installHttpInterceptor(accountManager, tracker, rotator);

	// --- Account changes → notify auth provider ---
	context.subscriptions.push(
		accountManager.onDidChangeActive(account => {
			if (account) {
				authProvider.notifySessionChanged(account);
			}
		})
	);

	// --- Daily reset check ---
	rotator.resetDailyCountsIfNeeded();
	const resetInterval = setInterval(() => rotator.resetDailyCountsIfNeeded(), 60 * 60 * 1000);

	// --- Account Panel (M3 glassmorphic webview) ---
	const accountPanel = new AccountPanelProvider(
		context,
		accountManager,
		/* onAddAccount */    () => vscode.commands.executeCommand('macide.addAccount'),
		/* onSwitchAccount */ async (id) => {
			const target = accountManager.getAll().find(a => a.id === id);
			if (target) await accountManager.setActive(target);
		},
		/* onRemoveAccount */ async (id) => {
			await accountManager.removeAccountById(id);
			notifications.info('Account removed.');
		},
		/* onRenameAccount */ async (id, alias) => {
			const acc = accountManager.getAll().find(a => a.id === id);
			if (acc) {
				acc.alias = alias;
				await accountManager.updateAccount(acc);
			}
		}
	);

	// --- Status bar account pill ---
	const accountStatusBar = new AccountStatusBar(
		accountManager,
		'macide.openAccountPanel',
		'macide.addAccount'
	);

	// --- Commands ---
	context.subscriptions.push(
		/**
		 * macide.addAccount — starts a GitHub Device Flow and stores the result.
		 * Triggered directly by this command, or indirectly when Copilot calls
		 * vscode.authentication.getSession('github', [...]) and no session exists.
		 */
		vscode.commands.registerCommand('macide.addAccount', async () => {
			try {
				// getSession with createIfNone:true will call authProvider.createSession()
				await vscode.authentication.getSession('github', ['read:user', 'repo'], {
					createIfNone: true
				});
			} catch (err: unknown) {
				// User cancelled or client ID not configured — surface a friendly message
				const msg = err instanceof Error ? err.message : String(err);
				vscode.window.showErrorMessage(`Macide: Failed to add account — ${msg}`);
			}
		}),

		vscode.commands.registerCommand('macide.openAccountPanel', () => {
			accountPanel.open();
		}),

		vscode.commands.registerCommand('macide.removeAccount', async () => {
			const all = accountManager.getAll();
			if (!all.length) {
				notifications.info('No accounts to remove.');
				return;
			}
			const selected = await vscode.window.showQuickPick(
				all.map(a => ({ label: a.alias, description: `@${a.githubUsername}`, id: a.id })),
				{ placeHolder: 'Select account to remove' }
			);
			if (!selected) return;
			const confirmed = await vscode.window.showWarningMessage(
				`Remove "${selected.label}" (@${selected.description?.replace('@','')})? The token will be deleted from the OS keychain.`,
				{ modal: true }, 'Remove'
			);
			if (confirmed === 'Remove') {
				await accountManager.removeAccountById((selected as any).id);
				notifications.info(`Removed ${selected.label}.`);
			}
		}),

		vscode.commands.registerCommand('macide.switchAccount', () => {
			vscode.commands.executeCommand('macide.openAccountPanel');
		}),

		vscode.commands.registerCommand('macide.showAccountStatus', () => {
			const active = accountManager.getActive();
			if (!active) {
				notifications.info('No active account. Use "Add Account" to get started.');
				return;
			}
			const pct = Math.round((active.requestCount / 300) * 100);
			notifications.info(`Active: ${active.alias} (@${active.githubUsername}) — ${active.requestCount} requests today (~${pct}% of limit)`);
		})
	);

	// --- Cleanup ---
	context.subscriptions.push(
		accountPanel,
		accountStatusBar,
		{
			dispose: () => {
				clearInterval(resetInterval);
				uninstallHttpInterceptor();
				authProvider.dispose();
				accountManager.dispose();
				credentialBridge.dispose();
			}
		}
	);
}

export function deactivate(): void {
	uninstallHttpInterceptor();
}
