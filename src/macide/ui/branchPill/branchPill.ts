/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Branch Status Bar Pill (spec §5.3 / §7.11).
 *
 * Sits in the status bar (left side, just after the existing VS Code source-
 * control items). Shows:
 *   $(git-branch) <name>  [dirty dot]  [↑ahead ↓behind]
 *
 * Click → macide.openBranchSwitcher (glassmorphic quick-pick).
 *
 * Refreshes on:
 *   • repository state change (HEAD / refs / working tree)
 *   • active editor change (to pick up the right repo)
 *   • 5-second poll (fallback for edge cases)
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getGitApi, getActiveRepo } from '../../git/gitApi';
import type { Repository } from '../../git/gitApi';

const POLL_MS = 5000;

export class BranchPill implements vscode.Disposable {
	private readonly _item:        vscode.StatusBarItem;
	private readonly _disposables: vscode.Disposable[]  = [];
	private          _pollTimer:   ReturnType<typeof setInterval> | undefined;
	private          _repoSub:     vscode.Disposable | undefined;

	constructor() {
		// Priority 10_100 — appears left of the account pill (10_000)
		this._item = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			10_100
		);
		this._item.command   = 'macide.openBranchSwitcher';
		this._item.tooltip   = new vscode.MarkdownString('**Branch** — Click to switch', true);
		this._item.name      = 'Macide Branch Pill';
		this._item.show();

		// Refresh when the active editor changes (different repo might activate)
		this._disposables.push(
			vscode.window.onDidChangeActiveTextEditor(() => this._refresh())
		);

		// Poll as a coarse fallback
		this._pollTimer = setInterval(() => this._refresh(), POLL_MS);

		// Initial render
		this._refresh();
	}

	// ── Refresh ───────────────────────────────────────────────────────────────

	private _refresh(): void {
		const repo = getActiveRepo();

		// Detach old subscription
		this._repoSub?.dispose();
		this._repoSub = undefined;

		if (!repo) {
			this._renderNoRepo();
			return;
		}

		// Subscribe to state changes for this repo
		this._repoSub = repo.state.onDidChange(() => this._renderRepo(repo));
		this._renderRepo(repo);
	}

	private _renderNoRepo(): void {
		this._item.text    = '$(git-branch) —';
		this._item.tooltip = 'No git repository';
		this._item.color   = undefined;
		this._item.backgroundColor = undefined;
	}

	private _renderRepo(repo: Repository): void {
		const state  = repo.state;
		const head   = state.HEAD;

		if (!head) {
			this._item.text    = '$(git-branch) detached';
			this._item.tooltip = 'Detached HEAD';
			this._item.color   = new vscode.ThemeColor('statusBarItem.warningForeground');
			return;
		}

		const branchName = head.name ?? '(no branch)';
		const isDirty    = state.indexChanges.length > 0
		                || state.workingTreeChanges.length > 0;
		const ahead      = head.ahead  ?? 0;
		const behind     = head.behind ?? 0;

		let text = `$(git-branch) ${branchName}`;
		if (isDirty) text += ' •';
		if (ahead  > 0) text += ` $(arrow-up)${ahead}`;
		if (behind > 0) text += ` $(arrow-down)${behind}`;

		const tooltip = new vscode.MarkdownString(undefined, true);
		tooltip.appendMarkdown(`**$(git-branch) ${branchName}**\n\n`);
		if (isDirty) tooltip.appendMarkdown('_Uncommitted changes present_\n\n');
		if (ahead  > 0) tooltip.appendMarkdown(`$(arrow-up) **${ahead}** ahead of upstream\n\n`);
		if (behind > 0) tooltip.appendMarkdown(`$(arrow-down) **${behind}** behind upstream\n\n`);
		tooltip.appendMarkdown('_Click to switch branch_');

		this._item.text    = text;
		this._item.tooltip = tooltip;
		this._item.color   = isDirty
			? new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
			: undefined;
		this._item.backgroundColor = undefined;
	}

	// ── Branch switcher quick-pick ────────────────────────────────────────────

	static async openBranchSwitcher(): Promise<void> {
		const api = getGitApi();
		if (!api || !api.repositories.length) {
			vscode.window.showInformationMessage('No git repository found.');
			return;
		}

		const repo  = getActiveRepo()!;
		const state = repo.state;
		const head  = state.HEAD?.name;

		// Build items: Local | Remote | New Branch
		const items: (vscode.QuickPickItem & { ref?: string })[] = [
			{
				label:       '$(add) New Branch…',
				description: '',
				detail:      'Create a new branch from the current HEAD',
				ref:         '__new__'
			},
			{ kind: vscode.QuickPickItemKind.Separator, label: 'Local Branches' }
		];

		for (const ref of state.refs) {
			if (ref.type !== 0 /* Head */ || !ref.name) continue; // 0 = RefType.Head
			if (ref.name === head) continue; // don't show current branch
			items.push({
				label:       `$(git-branch) ${ref.name}`,
				description: ref.commit?.slice(0, 7),
				ref:         ref.name
			});
		}

		const remotes = state.refs.filter(r => r.type === 1 && r.name); // RefType.RemoteHead = 1
		if (remotes.length) {
			items.push({ kind: vscode.QuickPickItemKind.Separator, label: 'Remote Branches' });
			for (const ref of remotes) {
				items.push({
					label:       `$(git-branch) ${ref.name!}`,
					description: ref.commit?.slice(0, 7),
					ref:         ref.name
				});
			}
		}

		const pick = await vscode.window.showQuickPick(items, {
			placeHolder:   head ? `Current: ${head} — select to switch` : 'Switch branch',
			matchOnDetail: true
		});

		if (!pick || !pick.ref) return;

		if (pick.ref === '__new__') {
			const name = await vscode.window.showInputBox({
				prompt:      'New branch name',
				placeHolder: 'feature/my-branch',
				validateInput: v => /^[a-zA-Z0-9._\-/]+$/.test(v) ? undefined : 'Invalid branch name'
			});
			if (name) {
				await vscode.commands.executeCommand('git.branch', name);
			}
		} else {
			await vscode.commands.executeCommand('git.checkout', pick.ref);
		}
	}

	dispose(): void {
		clearInterval(this._pollTimer);
		this._repoSub?.dispose();
		this._item.dispose();
		this._disposables.forEach(d => d.dispose());
	}
}
