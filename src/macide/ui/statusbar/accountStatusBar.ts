/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Account Status Bar Item — "account pill" in the bottom status bar.
 *
 * Spec §5.5 (right side): active account name + status dot.
 * This is the M3 entry point for the title bar account pill —
 * it lives in the status bar until the custom frameless title bar is built in M6.
 *
 * Colours map to VS Code ThemeColors so they respect any active color theme and
 * fall back gracefully in environments without full GPU compositing.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { MacideAccount } from '../../auth/provider';
import { AccountManager } from '../../accounts/manager';

// Status icons: Unicode circle + coloured via backgroundColor
const STATUS_DOT: Record<MacideAccount['status'], string> = {
	healthy:   '$(circle-filled)', // green
	warning:   '$(warning)',       // amber
	exhausted: '$(error)',         // red
	idle:      '$(circle-outline)' // muted
};

const STATUS_COLOR: Record<MacideAccount['status'], vscode.ThemeColor> = {
	healthy:   new vscode.ThemeColor('macide.statusbar.accountHealthy'),
	warning:   new vscode.ThemeColor('macide.statusbar.accountWarning'),
	exhausted: new vscode.ThemeColor('macide.statusbar.accountExhausted'),
	idle:      new vscode.ThemeColor('macide.statusbar.accountIdle')
};

/** Fallback colours for environments / themes that don't define Macide ThemeColors. */
const STATUS_FALLBACK_BG: Record<MacideAccount['status'], vscode.ThemeColor> = {
	healthy:   new vscode.ThemeColor('statusBarItem.prominentBackground'),
	warning:   new vscode.ThemeColor('statusBarItem.warningBackground'),
	exhausted: new vscode.ThemeColor('statusBarItem.errorBackground'),
	idle:      new vscode.ThemeColor('statusBarItem.remoteBackground')
};

export class AccountStatusBar implements vscode.Disposable {
	private readonly _item: vscode.StatusBarItem;
	private readonly _disposables: vscode.Disposable[] = [];

	constructor(
		private readonly _accountManager: AccountManager,
		openPanelCommand: string,
		addAccountCommand: string
	) {
		// Priority 10 000 → appears near the right edge, before language mode
		this._item = vscode.window.createStatusBarItem(
			'macide.accountPill',
			vscode.StatusBarAlignment.Right,
			10_000
		);
		this._item.name = 'Macide Account';
		this._item.command = openPanelCommand;
		this._item.tooltip = new vscode.MarkdownString(
			'**Macide** — Active GitHub Account\n\nClick to open Account Panel',
			true
		);

		this._update();
		this._item.show();

		// React to account changes
		this._disposables.push(
			_accountManager.onDidChangeActive(() => this._update()),
			_accountManager.onDidChangeAccounts(() => this._update())
		);
	}

	// -------------------------------------------------------------------------
	// Private
	// -------------------------------------------------------------------------

	private _update(): void {
		const active = this._accountManager.getActive();
		const all = this._accountManager.getAll();

		if (!active) {
			this._item.text = '$(person-add) Add Account';
			this._item.tooltip = new vscode.MarkdownString('**Macide** — No account signed in\n\nClick to add a GitHub account', true);
			this._item.backgroundColor = undefined;
			this._item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
			return;
		}

		const icon = STATUS_DOT[active.status] ?? '$(circle-filled)';
		const alias = active.alias.length > 20 ? active.alias.slice(0, 18) + '…' : active.alias;
		const accountCount = all.length > 1 ? ` (${all.length})` : '';

		this._item.text = `${icon} ${alias}${accountCount}`;
		this._item.color = STATUS_COLOR[active.status];
		this._item.backgroundColor =
			active.status === 'exhausted' ? STATUS_FALLBACK_BG.exhausted :
			active.status === 'warning'   ? STATUS_FALLBACK_BG.warning  :
			undefined;

		// Rich tooltip with usage info
		const limit = vscode.workspace.getConfiguration('macide').get<number>('accounts.assumedDailyLimit', 300);
		const pct = Math.round((active.requestCount / limit) * 100);
		const md = new vscode.MarkdownString(undefined, true);
		md.appendMarkdown(
			`**${active.alias}** · @${active.githubUsername}\n\n` +
			`Status: **${active.status}**  ·  ${active.requestCount}/${limit} requests today (~${pct}%)\n\n` +
			`_${all.length} account${all.length !== 1 ? 's' : ''} total — click to manage_`
		);
		this._item.tooltip = md;
	}

	dispose(): void {
		this._item.dispose();
		for (const d of this._disposables) d.dispose();
	}
}
