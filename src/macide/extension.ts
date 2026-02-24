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
// --- M5 Git Enhancements ---
import { generateCommitMessage } from './git/aiCommitMessage';
import { BlameAnnotationController } from './git/blameAnnotation';
import { GitHistoryPanel } from './git/historyGraph';
import { ConflictBarProvider, resolveConflict } from './git/conflictBar';
import { StashManagerPanel } from './git/stashManager';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	// --- Core services ---
	const notifications = new NotificationService();
	const accountManager = new AccountManager(context);
	await accountManager.load();

	const rotator = new AccountRotator(accountManager, notifications);
	const tracker = new AccountTracker(accountManager, rotator, context);
	const credentialBridge = new CredentialBridge(accountManager, notifications);

	/** Read macide.* settings and apply to rotator + tracker. */
	function syncSettings(): void {
		const cfg = vscode.workspace.getConfiguration('macide');
		const strategy = cfg.get<string>('accounts.rotationStrategy', 'round-robin') as 'round-robin' | 'least-used' | 'manual';
		const limit    = cfg.get<number>('accounts.assumedDailyLimit', 300);
		rotator.strategy  = strategy;
		tracker.dailyLimit = limit;
	}
	syncSettings();

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

	// --- Keep rotator + tracker in sync with settings changes ---
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('macide.accounts.rotationStrategy') ||
			    e.affectsConfiguration('macide.accounts.assumedDailyLimit')) {
				syncSettings();
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
			const limit = vscode.workspace.getConfiguration('macide').get<number>('accounts.assumedDailyLimit', 300);
			const pct = Math.round((active.requestCount / limit) * 100);
			notifications.info(`Active: ${active.alias} (@${active.githubUsername}) — ${active.requestCount} requests today (~${pct}% of limit)`);
		}),

		// --- M4 debug / testing commands ---

		/**
		 * macide.simulateRateLimit — marks the active account exhausted and
		 * triggers the rotation logic exactly as if a real 429 was received.
		 * Useful for verifying the full rotation path without waiting for
		 * GitHub to actually rate-limit you.
		 */
		vscode.commands.registerCommand('macide.simulateRateLimit', () => {
			const active = accountManager.getActive();
			if (!active) {
				notifications.info('No active account to simulate rate-limit on.');
				return;
			}
			rotator.onRateLimitDetected(active);
		}),

		/**
		 * macide.resetUsageCounts — zeroes request counters for all accounts
		 * and resets statuses to 'healthy'. Use after a simulateRateLimit test
		 * to return to a clean state.
		 */
		vscode.commands.registerCommand('macide.resetUsageCounts', async () => {
			const all = accountManager.getAll();
			for (const acc of all) {
				await tracker.resetAccount(acc);
			}
			if (all.length) {
				notifications.info(`Reset usage counts for ${all.length} account${all.length !== 1 ? 's' : ''}. Statuses restored to healthy.`);
			} else {
				notifications.info('No accounts to reset.');
			}
		})
	);

	// ── M5: Git Enhancements ──────────────────────────────────────────────────

	// Blame annotations
	const blameController = new BlameAnnotationController();

	// Git history graph panel
	const historyPanel = new GitHistoryPanel();

	// Inline conflict bar (CodeLens)
	const conflictBar = new ConflictBarProvider();
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, conflictBar)
	);

	// Stash manager panel
	const stashPanel = new StashManagerPanel();

	context.subscriptions.push(
		// Open git history graph (keybinding: Ctrl/Cmd+Shift+G H)
		vscode.commands.registerCommand('macide.openGitHistory', () => {
			historyPanel.open();
		}),

		// Generate AI commit message for staged changes
		vscode.commands.registerCommand('macide.generateCommitMessage', () => {
			generateCommitMessage(context);
		}),

		// Toggle inline blame annotations (current-line → all-lines → off)
		vscode.commands.registerCommand('macide.toggleBlame', () => {
			blameController.toggle();
		}),

		// Clear blame annotations without changing mode
		vscode.commands.registerCommand('macide.clearBlame', () => {
			blameController.clear();
		}),

		// Conflict resolution actions
		vscode.commands.registerCommand('macide.conflict.keepOurs', (uri, block) => {
			resolveConflict(uri, block, 'ours');
		}),
		vscode.commands.registerCommand('macide.conflict.keepTheirs', (uri, block) => {
			resolveConflict(uri, block, 'theirs');
		}),
		vscode.commands.registerCommand('macide.conflict.keepBoth', (uri, block) => {
			resolveConflict(uri, block, 'both');
		}),
		vscode.commands.registerCommand('macide.conflict.open3Way', (uri, block) => {
			resolveConflict(uri, block, '3way');
		}),

		// Stash manager
		vscode.commands.registerCommand('macide.openStashManager', () => {
			stashPanel.open();
		}),

		// Credential bridge — check cross-account remote when opening a workspace
		vscode.commands.registerCommand('macide.checkCrossAccountRemote', (remoteUrl: string) => {
			credentialBridge.checkCrossAccountRemote(remoteUrl);
		})
	);

	// --- Cleanup ---
	context.subscriptions.push(
		accountPanel,
		accountStatusBar,
		blameController,
		historyPanel,
		conflictBar,
		stashPanel,
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
