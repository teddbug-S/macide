/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Inline Git Blame Annotations (spec §7.8).
 *
 * Modes:
 *   current-line  (default) — appears 500ms after cursor stops on a line
 *   all-lines               — annotates every line in the file
 *   off                     — nothing shown
 *
 * Annotation format: `author · relative time · short hash`
 * Hover: full commit message tooltip.
 *
 * Commands:
 *   macide.toggleBlame      — cycles current-line → all-lines → off
 *   macide.clearBlame       — hides all annotations
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { relativeTime } from './gitApi';

type BlameMode = 'current-line' | 'all-lines' | 'off';

// Decoration type — muted, fixed-width right-aligned gutter text
const BLAME_DECO = vscode.window.createTextEditorDecorationType({
	after: {
		color:          new vscode.ThemeColor('editorCodeLens.foreground'),
		fontStyle:      'italic',
		fontWeight:     'normal',
		margin:         '0 0 0 3em',
		textDecoration: 'none; opacity: 0.4;'
	},
	isWholeLine: true
});

interface BlameEntry {
	hash:    string;
	author:  string;
	date:    Date;
	summary: string;
}

/** Cache: file path → (line number → blame entry). Cleared on save. */
const _blameCache = new Map<string, Map<number, BlameEntry>>();

// ---------------------------------------------------------------------------
// Blame runner
// ---------------------------------------------------------------------------

/**
 * Runs `git blame --porcelain -L <line>,<endLine>` for the given file and
 * returns the parsed entries keyed by 1-based line number.
 */
function runBlame(filePath: string, startLine: number, endLine: number): Promise<Map<number, BlameEntry>> {
	return new Promise(resolve => {
		const cwd = path.dirname(filePath);
		const args = ['blame', '--porcelain', `-L${startLine},${endLine}`, '--', filePath];

		cp.execFile('git', args, { cwd, timeout: 5000 }, (err, stdout) => {
			const result = new Map<number, BlameEntry>();
			if (err || !stdout.trim()) {
				resolve(result);
				return;
			}

			// Porcelain format: each hunk starts with `<hash> <orig_line> <final_line> [group_size]`
			// followed by tag lines (`author`, `author-time`, `summary`, etc.)
			const lines = stdout.split('\n');
			let i = 0;
			let currentLine = startLine;

			while (i < lines.length) {
				const header = lines[i];
				if (!header || header.length < 40) { i++; continue; }

				const parts = header.split(' ');
				if (parts.length < 3) { i++; continue; }

				const hash         = parts[0];
				const finalLineNum = parseInt(parts[2], 10);

				let author  = '';
				let timestamp = 0;
				let summary = '';

				i++;
				while (i < lines.length && !lines[i].startsWith('\t')) {
					const tagLine = lines[i];
					if (tagLine.startsWith('author '))        author    = tagLine.slice(7).trim();
					else if (tagLine.startsWith('author-time ')) timestamp = parseInt(tagLine.slice(12).trim(), 10);
					else if (tagLine.startsWith('summary '))   summary   = tagLine.slice(8).trim();
					i++;
				}
				i++; // skip the `\t<line content>` line

				if (!isNaN(finalLineNum)) {
					result.set(finalLineNum, {
						hash:   hash.slice(0, 7),
						author,
						date:   new Date(timestamp * 1000),
						summary
					});
				}
				currentLine = finalLineNum + 1;
			}

			resolve(result);
		});
	});
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class BlameAnnotationController implements vscode.Disposable {
	private _mode: BlameMode;
	private _disposables: vscode.Disposable[] = [];
	private _debounceTimer: ReturnType<typeof setTimeout> | undefined;

	constructor() {
		const cfg = vscode.workspace.getConfiguration('macide');
		this._mode = cfg.get<BlameMode>('git.inlineBlame', 'current-line');

		// Cursor change → debounced refresh (current-line mode)
		this._disposables.push(
			vscode.window.onDidChangeTextEditorSelection(e => {
				if (this._mode !== 'current-line') return;
				clearTimeout(this._debounceTimer);
				this._debounceTimer = setTimeout(
					() => this._refreshCurrentLine(e.textEditor),
					500
				);
			})
		);

		// Active editor change → refresh
		this._disposables.push(
			vscode.window.onDidChangeActiveTextEditor(editor => {
				if (!editor) return;
				if (this._mode === 'all-lines') {
					this._refreshAllLines(editor);
				} else if (this._mode === 'current-line') {
					this._refreshCurrentLine(editor);
				}
			})
		);

		// Document save → invalidate cache
		this._disposables.push(
			vscode.workspace.onDidSaveTextDocument(doc => {
				_blameCache.delete(doc.uri.fsPath);
				// Re-annotate if relevant editor is active
				const editor = vscode.window.activeTextEditor;
				if (editor && editor.document === doc && this._mode !== 'off') {
					if (this._mode === 'all-lines') this._refreshAllLines(editor);
					else this._refreshCurrentLine(editor);
				}
			})
		);

		// Settings change
		this._disposables.push(
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('macide.git.inlineBlame')) {
					this._mode = vscode.workspace.getConfiguration('macide').get<BlameMode>('git.inlineBlame', 'current-line');
					this._applyMode();
				}
			})
		);

		this._applyMode();
	}

	// -------------------------------------------------------------------------

	toggle(): void {
		const cycle: BlameMode[] = ['current-line', 'all-lines', 'off'];
		const next = cycle[(cycle.indexOf(this._mode) + 1) % cycle.length];
		this._mode = next;
		vscode.workspace.getConfiguration('macide').update('git.inlineBlame', next, vscode.ConfigurationTarget.Global);
		this._applyMode();
	}

	clear(): void {
		vscode.window.visibleTextEditors.forEach(e => e.setDecorations(BLAME_DECO, []));
	}

	// -------------------------------------------------------------------------

	private _applyMode(): void {
		this.clear();
		const editor = vscode.window.activeTextEditor;
		if (!editor || this._mode === 'off') return;

		if (this._mode === 'all-lines') {
			this._refreshAllLines(editor);
		} else {
			this._refreshCurrentLine(editor);
		}
	}

	private async _refreshCurrentLine(editor: vscode.TextEditor): Promise<void> {
		if (this._mode !== 'current-line') return;

		const filePath = editor.document.uri.fsPath;
		if (editor.document.uri.scheme !== 'file') return;

		const line = editor.selection.active.line + 1; // 1-based
		const entry = await this._getEntry(filePath, line);

		if (!entry) {
			editor.setDecorations(BLAME_DECO, []);
			return;
		}

		const range = editor.document.lineAt(line - 1).range;
		const hover = new vscode.MarkdownString(
			`**${entry.hash}** by ${entry.author}  \n${entry.date.toLocaleString()}  \n\n${entry.summary}`
		);

		editor.setDecorations(BLAME_DECO, [{
			range,
			renderOptions: {
				after: {
					contentText: `${entry.author} · ${relativeTime(entry.date)} · ${entry.hash}`
				}
			},
			hoverMessage: hover
		}]);
	}

	private async _refreshAllLines(editor: vscode.TextEditor): Promise<void> {
		if (this._mode !== 'all-lines') return;

		const filePath = editor.document.uri.fsPath;
		if (editor.document.uri.scheme !== 'file') return;

		const lineCount = editor.document.lineCount;
		const entries = await this._getEntries(filePath, 1, lineCount);

		const decorations: vscode.DecorationOptions[] = [];
		for (let lineNum = 1; lineNum <= lineCount; lineNum++) {
			const entry = entries.get(lineNum);
			if (!entry) continue;

			const range = editor.document.lineAt(lineNum - 1).range;
			const hover = new vscode.MarkdownString(
				`**${entry.hash}** by ${entry.author}  \n${entry.date.toLocaleString()}  \n\n${entry.summary}`
			);
			decorations.push({
				range,
				renderOptions: {
					after: {
						contentText: `${entry.author} · ${relativeTime(entry.date)} · ${entry.hash}`
					}
				},
				hoverMessage: hover
			});
		}
		editor.setDecorations(BLAME_DECO, decorations);
	}

	// -------------------------------------------------------------------------
	// Cache helpers

	private async _getEntry(filePath: string, line: number): Promise<BlameEntry | undefined> {
		let fileCache = _blameCache.get(filePath);
		if (!fileCache) {
			fileCache = new Map();
			_blameCache.set(filePath, fileCache);
		}
		if (!fileCache.has(line)) {
			const fresh = await runBlame(filePath, line, line);
			fresh.forEach((v, k) => fileCache!.set(k, v));
		}
		return fileCache.get(line);
	}

	private async _getEntries(filePath: string, start: number, end: number): Promise<Map<number, BlameEntry>> {
		let fileCache = _blameCache.get(filePath);
		if (fileCache && fileCache.size >= (end - start + 1)) {
			return fileCache;
		}
		const fresh = await runBlame(filePath, start, end);
		if (!fileCache) {
			_blameCache.set(filePath, fresh);
			return fresh;
		}
		fresh.forEach((v, k) => fileCache!.set(k, v));
		return fileCache;
	}

	dispose(): void {
		clearTimeout(this._debounceTimer);
		BLAME_DECO.dispose();
		this._disposables.forEach(d => d.dispose());
		_blameCache.clear();
	}
}
