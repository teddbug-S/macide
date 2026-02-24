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
			// TODO M3: open glassmorphic account panel webview
			vscode.window.showQuickPick(
				accountManager.getAll().map(a => ({
					label: a.alias,
					description: `@${a.githubUsername}  •  ${a.id === accountManager.getActive()?.id ? 'Active' : a.status}`,
					id: a.id
				})),
				{ placeHolder: 'Select GitHub account for Copilot' }
			).then(async selected => {
				if (!selected) return;
				const account = accountManager.getAll().find(a => a.id === (selected as any).id);
				if (account) await accountManager.setActive(account);
			});
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
	context.subscriptions.push({
		dispose: () => {
			clearInterval(resetInterval);
			uninstallHttpInterceptor();
			authProvider.dispose();
			accountManager.dispose();
			credentialBridge.dispose();
		}
	});
}

export function deactivate(): void {
	uninstallHttpInterceptor();
}
