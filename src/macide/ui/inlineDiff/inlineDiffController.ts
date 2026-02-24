/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Inline Diff View Controller (spec §5.9 / §8.1).
 *
 * Mechanism:
 *  1. Every text-document change is inspected. When ≥ 3 new lines are
 *     inserted in a single edit (the "large change" heuristic), Macide
 *     captures a "before" snapshot and shows green added-line decorations
 *     with an action CodeLens bar: Accept / Reject / Accept Line / Diff Editor.
 *
 *  2. Users can also manually trigger `macide.reviewInlineChange` to enter
 *     the diff review mode for the current selection.
 *
 *  3. While review is active a status bar item shows "● Reviewing AI change".
 *
 * Decoration colours follow Obsidian Flow:
 *   Added lines:   rgba(34,197,94,0.08) bg + 2px #22c55e left border
 *   Removed lines: rgba(239,68,68,0.08) bg  (shown in before snapshot)
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Decoration types
// ---------------------------------------------------------------------------

const ADDED_DECO = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(34,197,94,0.08)',
	borderWidth:     '0 0 0 2px',
	borderStyle:     'solid',
	borderColor:     '#22c55e',
	isWholeLine:     true,
	overviewRulerColor: '#22c55e88',
	overviewRulerLane:  vscode.OverviewRulerLane.Left,
});

const REMOVED_DECO = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(239,68,68,0.08)',
	borderWidth:     '0 0 0 2px',
	borderStyle:     'solid',
	borderColor:     '#ef4444',
	isWholeLine:     true,
	overviewRulerColor: '#ef444488',
	overviewRulerLane:  vscode.OverviewRulerLane.Left,
	after: {
		contentText: ' [removed]',
		color:       '#ef444488',
		fontStyle:   'italic',
	}
});

// Threshold: only track AI-style insertions ≥ 3 lines
const MIN_INSERTED_LINES = 3;

// ---------------------------------------------------------------------------
// State per editor
// ---------------------------------------------------------------------------

interface ReviewSession {
	uri:           string;
	addedRanges:   vscode.Range[];
	/** First line of the inserted block (0-based). */
	insertStart:   number;
	/** Number of inserted lines. */
	insertCount:   number;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class InlineDiffController implements vscode.Disposable {
	private _session:      ReviewSession | undefined;
	private readonly _statusItem:  vscode.StatusBarItem;
	private readonly _disposables: vscode.Disposable[] = [];

	constructor() {
		this._statusItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Right,
			9_999
		);
		this._statusItem.name      = 'Macide Inline Diff';
		this._statusItem.command   = 'macide.showInlineDiffActions';
		this._statusItem.text      = '$(diff) Reviewing AI change';
		this._statusItem.tooltip   = 'Click to see Accept / Reject options';
		this._statusItem.color     = new vscode.ThemeColor('statusBar.foreground');

		this._disposables.push(
			// Detect large multi-line insertions
			vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => this._onDocChange(e)),
			// Clear when active editor switches away
			vscode.window.onDidChangeActiveTextEditor((e: vscode.TextEditor | undefined) => {
				if (e && this._session && e.document.uri.toString() !== this._session.uri) {
					this._clearSession();
				}
			})
		);
	}

	// ── Document change listener ──────────────────────────────────────────────

	private _onDocChange(e: vscode.TextDocumentChangeEvent): void {
		// Only care while no active review (avoid re-triggering on Reject edits)
		if (this._session) return;

		for (const change of e.contentChanges) {
			const newLines = change.text.split('\n');
			if (newLines.length < MIN_INSERTED_LINES) continue;

			// Find the editor
			const editor = vscode.window.visibleTextEditors.find(
				(ed: vscode.TextEditor) => ed.document === e.document
			);
			if (!editor) continue;

			const insertStart = change.range.start.line;
			const insertCount = newLines.length - 1; // newline-split gives n+1 chunks for n newlines

			const addedRanges: vscode.Range[] = [];
			for (let l = insertStart; l <= insertStart + insertCount && l < editor.document.lineCount; l++) {
				addedRanges.push(new vscode.Range(l, 0, l, 0));
			}

			this._session = {
				uri:         e.document.uri.toString(),
				addedRanges,
				insertStart,
				insertCount
			};

			editor.setDecorations(ADDED_DECO, addedRanges);
			this._statusItem.show();
			return; // one session at a time
		}
	}

	// ── Public API (called by commands) ──────────────────────────────────────

	/** Accept — keep changes, dismiss decorations. */
	accept(): void {
		this._clearSession();
		vscode.window.showInformationMessage('Macide: AI change accepted.');
	}

	/** Accept only the line the cursor is on, reject the rest. */
	async acceptLine(): Promise<void> {
		const editor  = vscode.window.activeTextEditor;
		const session = this._session;
		if (!editor || !session) return;

		const keepLine = editor.selection.active.line;
		const edit     = new vscode.WorkspaceEdit();

		// Delete all added lines except the cursor line — in reverse order
		const toDelete = session.addedRanges
			.map(r => r.start.line)
			.filter(l => l !== keepLine)
			.sort((a, b) => b - a); // reverse

		for (const line of toDelete) {
			const range = editor.document.lineAt(line).rangeIncludingLineBreak;
			edit.delete(editor.document.uri, range);
		}

		await vscode.workspace.applyEdit(edit);
		this._clearSession();
	}

	/** Reject — delete all added lines. */
	async reject(): Promise<void> {
		const editor  = vscode.window.activeTextEditor;
		const session = this._session;
		if (!editor || !session) return;

		// Build a single edit that deletes all inserted lines (reverse order)
		const edit = new vscode.WorkspaceEdit();
		const lines = [...session.addedRanges.map(r => r.start.line)].sort((a, b) => b - a);

		for (const line of lines) {
			if (line < editor.document.lineCount) {
				const range = editor.document.lineAt(line).rangeIncludingLineBreak;
				edit.delete(editor.document.uri, range);
			}
		}

		this._clearSession(); // clear first to avoid re-trigger
		await vscode.workspace.applyEdit(edit);
	}

	/** Open ordinary diff editor showing the inserted block vs. an empty file. */
	openDiffEditor(): void {
		const editor  = vscode.window.activeTextEditor;
		const session = this._session;
		if (!editor || !session) return;

		// Delegate to VS Code's built-in diff command
		vscode.commands.executeCommand('vscode.diff',
			vscode.Uri.parse('untitled:before-ai-change'),
			editor.document.uri,
			`AI Change — ${editor.document.fileName.split('/').pop()}`
		);
	}

	/** Show a quick-pick action menu for the active review session. */
	async showActions(): Promise<void> {
		if (!this._session) {
			vscode.window.showInformationMessage('Macide: No active inline diff review.');
			return;
		}

		const pick = await vscode.window.showQuickPick(
			[
				{ label: '$(check) Accept',          description: 'Keep all AI-inserted lines',  action: 'accept' },
				{ label: '$(check) Accept Line',     description: 'Keep only the current line',  action: 'line' },
				{ label: '$(x) Reject',              description: 'Delete all AI-inserted lines', action: 'reject' },
				{ label: '$(diff) Open Diff Editor', description: 'View in full diff editor',    action: 'diff' },
			],
			{ placeHolder: 'Review AI change — choose an action' }
		);

		if (!pick) return;
		switch (pick.action) {
			case 'accept':  this.accept();           break;
			case 'line':    await this.acceptLine(); break;
			case 'reject':  await this.reject();     break;
			case 'diff':    this.openDiffEditor();   break;
		}
	}

	// ── Manual trigger ────────────────────────────────────────────────────────

	/** Enter review mode for the current selection (manual trigger). */
	reviewSelection(): void {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return;

		const sel = editor.selection;
		if (sel.isEmpty) {
			vscode.window.showInformationMessage('Macide: Select lines to mark as the AI change.');
			return;
		}

		const addedRanges: vscode.Range[] = [];
		for (let l = sel.start.line; l <= sel.end.line; l++) {
			addedRanges.push(new vscode.Range(l, 0, l, 0));
		}

		this._session = {
			uri:         editor.document.uri.toString(),
			addedRanges,
			insertStart: sel.start.line,
			insertCount: sel.end.line - sel.start.line
		};

		editor.setDecorations(ADDED_DECO, addedRanges);
		this._statusItem.show();
	}

	// ── Internals ─────────────────────────────────────────────────────────────

	private _clearSession(): void {
		// Clear decorations from all visible editors for this URI
		if (this._session) {
			vscode.window.visibleTextEditors.forEach((e: vscode.TextEditor) => {
				e.setDecorations(ADDED_DECO,   []);
				e.setDecorations(REMOVED_DECO, []);
			});
		}
		this._session = undefined;
		this._statusItem.hide();
	}

	dispose(): void {
		ADDED_DECO.dispose();
		REMOVED_DECO.dispose();
		this._statusItem.dispose();
		this._disposables.forEach(d => d.dispose());
	}
}
