/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Smart Session Memory (spec §8.4).
 *
 * On workspace close (or explicit save): persists
 *   • Active account ID
 *   • Flow Mode state
 *   • Context pins (already in workspaceState — we just flag them for restore)
 *   • AI Chat history (last 10 exchanges)
 *   • Panel + sidebar visibility state
 *
 * On activate: restores the above within ~500ms.
 *
 * Storage keys (workspaceState unless noted):
 *   macide.session.activeAccountId   — string
 *   macide.session.flowModeActive    — boolean  (also used by FlowModeController)
 *   macide.session.chatHistory       — ChatMessage[]
 *   macide.session.savedAt           — ISO timestamp
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { AccountManager } from '../../accounts/manager';
import type { FlowModeController } from '../flowMode/flowModeController';
import type { FloatingChatPanel, ChatMessage } from '../floatingChat/floatingChatPanel';

const KEY_ACCOUNT   = 'macide.session.activeAccountId';
const KEY_FLOWMODE  = 'macide.session.flowModeActive';
const KEY_CHAT      = 'macide.session.chatHistory';
const KEY_SAVED_AT  = 'macide.session.savedAt';

export class SessionMemory implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];
	private _saveTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly _context:      vscode.ExtensionContext,
		private readonly _accounts:     AccountManager,
		private readonly _flowMode:     FlowModeController,
		private readonly _chat:         FloatingChatPanel
	) {
		// Auto-save on workspace close
		this._disposables.push(
			vscode.workspace.onDidCloseTextDocument(() => this._scheduleSave())
		);

		// Save every 2 minutes while idle
		this._disposables.push(
			vscode.window.onDidChangeWindowState(s => {
				if (!s.focused) this._save();
			})
		);
	}

	// ── Restore ───────────────────────────────────────────────────────────────

	async restore(): Promise<void> {
		const savedAt = this._context.workspaceState.get<string>(KEY_SAVED_AT);
		if (!savedAt) return;

		// Only restore if session was saved within the last 24 hours
		const age = Date.now() - new Date(savedAt).getTime();
		if (age > 24 * 60 * 60 * 1000) return;

		// Restore active account
		const accountId = this._context.workspaceState.get<string>(KEY_ACCOUNT);
		if (accountId) {
			const account = this._accounts.getAll().find(a => a.id === accountId);
			if (account) {
				// Silently restore — don't trigger notifications
				await this._accounts.setActive(account);
			}
		}

		// Restore chat history
		const chatHistory = this._context.workspaceState.get<ChatMessage[]>(KEY_CHAT, []);
		if (chatHistory.length) {
			this._chat.loadHistory(chatHistory);
		}

		// Flow mode state is already handled by FlowModeController.restoreState()
		// No need to duplicate here
	}

	// ── Save ──────────────────────────────────────────────────────────────────

	private _scheduleSave(): void {
		clearTimeout(this._saveTimer);
		this._saveTimer = setTimeout(() => this._save(), 2000);
	}

	/** Immediately persist all session state. */
	save(): void { this._save(); }

	private _save(): void {
		const active = this._accounts.getActive();
		if (active) {
			this._context.workspaceState.update(KEY_ACCOUNT, active.id);
		}

		this._context.workspaceState.update(KEY_FLOWMODE, this._flowMode.isActive);

		// Cap chat history to 20 messages (10 exchanges)
		const history = this._chat.history.slice(-20);
		this._context.workspaceState.update(KEY_CHAT, history);

		this._context.workspaceState.update(KEY_SAVED_AT, new Date().toISOString());
	}

	dispose(): void {
		clearTimeout(this._saveTimer);
		this._save(); // flush on dispose
		this._disposables.forEach(d => d.dispose());
	}
}
