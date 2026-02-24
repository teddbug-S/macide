/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Inline Conflict Resolution Bar (spec §7.6).
 *
 * Detects `<<<<<<< HEAD` / `=======` / `>>>>>>>` conflict markers and shows
 * CodeLens actions above each conflict block:
 *   Keep Ours  |  Keep Theirs  |  Keep Both  |  3-Way View
 *
 * Green left border on "ours" lines, blue on "theirs".
 * On resolving all conflicts: toast "All conflicts resolved — Stage file?"
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Decorations
// ---------------------------------------------------------------------------

const OURS_DECO = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(34,197,94,0.08)',
	borderWidth:     '0 0 0 2px',
	borderStyle:     'solid',
	borderColor:     '#22c55e',
	isWholeLine:     true
});

const THEIRS_DECO = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(6,182,212,0.08)',
	borderWidth:     '0 0 0 2px',
	borderStyle:     'solid',
	borderColor:     '#06b6d4',
	isWholeLine:     true
});

const MARKER_DECO = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(124,58,237,0.08)',
	isWholeLine:     true,
	fontWeight:      'bold'
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConflictBlock {
	oursStart:   number; // 0-based line of `<<<<<<<`
	sepLine:     number; // line of `=======`
	theirsEnd:   number; // line of `>>>>>>>`
	oursRange:   vscode.Range;
	theirsRange: vscode.Range;
}

// ---------------------------------------------------------------------------
// CodeLens provider
// ---------------------------------------------------------------------------

export class ConflictBarProvider implements vscode.CodeLensProvider, vscode.Disposable {
	private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

	private readonly _disposables: vscode.Disposable[] = [];

	constructor() {
		// Refresh whenever any document changes
		this._disposables.push(
			vscode.workspace.onDidChangeTextDocument(e => {
				if (this._hasConflictFile(e.document)) {
					this._onDidChangeCodeLenses.fire();
					this._updateDecorations(e.document);
				}
			}),
			vscode.window.onDidChangeActiveTextEditor(editor => {
				if (editor) this._updateDecorations(editor.document);
			})
		);

		// Initial update
		if (vscode.window.activeTextEditor) {
			this._updateDecorations(vscode.window.activeTextEditor.document);
		}
	}

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		const blocks = findConflictBlocks(document);
		if (!blocks.length) return [];

		const lenses: vscode.CodeLens[] = [];

		for (const block of blocks) {
			const triggerLine  = new vscode.Range(block.oursStart, 0, block.oursStart, 0);

			lenses.push(
				new vscode.CodeLens(triggerLine, {
					title:     '$(check) Keep Ours',
					tooltip:   'Accept the current branch changes and discard theirs',
					command:   'macide.conflict.keepOurs',
					arguments: [document.uri, block]
				}),
				new vscode.CodeLens(triggerLine, {
					title:     '$(check) Keep Theirs',
					tooltip:   'Accept the incoming changes and discard ours',
					command:   'macide.conflict.keepTheirs',
					arguments: [document.uri, block]
				}),
				new vscode.CodeLens(triggerLine, {
					title:     '$(diff-added) Keep Both',
					tooltip:   'Keep both sets of changes concatenated',
					command:   'macide.conflict.keepBoth',
					arguments: [document.uri, block]
				}),
				new vscode.CodeLens(triggerLine, {
					title:     '$(diff-review-close) 3-Way View',
					tooltip:   'Open a 3-way diff editor for this conflict',
					command:   'macide.conflict.open3Way',
					arguments: [document.uri, block]
				})
			);
		}

		return lenses;
	}

	// -------------------------------------------------------------------------

	private _updateDecorations(document: vscode.TextDocument): void {
		const editors = vscode.window.visibleTextEditors.filter(
			e => e.document === document
		);
		if (!editors.length) return;

		const blocks = findConflictBlocks(document);
		const oursRanges:   vscode.Range[] = [];
		const theirsRanges: vscode.Range[] = [];
		const markerRanges: vscode.Range[] = [];

		for (const b of blocks) {
			for (let l = b.oursStart + 1; l < b.sepLine; l++) {
				oursRanges.push(new vscode.Range(l, 0, l, 0));
			}
			for (let l = b.sepLine + 1; l < b.theirsEnd; l++) {
				theirsRanges.push(new vscode.Range(l, 0, l, 0));
			}
			markerRanges.push(
				new vscode.Range(b.oursStart,  0, b.oursStart,  0),
				new vscode.Range(b.sepLine,    0, b.sepLine,    0),
				new vscode.Range(b.theirsEnd,  0, b.theirsEnd,  0)
			);
		}

		for (const editor of editors) {
			editor.setDecorations(OURS_DECO,   oursRanges);
			editor.setDecorations(THEIRS_DECO, theirsRanges);
			editor.setDecorations(MARKER_DECO, markerRanges);
		}
	}

	private _hasConflictFile(document: vscode.TextDocument): boolean {
		return document.getText().includes('<<<<<<<');
	}

	dispose(): void {
		OURS_DECO.dispose();
		THEIRS_DECO.dispose();
		MARKER_DECO.dispose();
		this._onDidChangeCodeLenses.dispose();
		this._disposables.forEach(d => d.dispose());
	}
}

// ---------------------------------------------------------------------------
// Conflict block parser
// ---------------------------------------------------------------------------

export function findConflictBlocks(document: vscode.TextDocument): ConflictBlock[] {
	const blocks: ConflictBlock[] = [];
	const text = document.getText();
	if (!text.includes('<<<<<<<')) return blocks;

	const lines = text.split('\n');
	let i = 0;

	while (i < lines.length) {
		if (lines[i].startsWith('<<<<<<<')) {
			const oursStart = i;
			let sepLine = -1;
			let theirsEnd = -1;

			for (let j = i + 1; j < lines.length; j++) {
				if (lines[j].startsWith('=======')) { sepLine = j; }
				if (lines[j].startsWith('>>>>>>>')) { theirsEnd = j; break; }
			}

			if (sepLine !== -1 && theirsEnd !== -1) {
				blocks.push({
					oursStart,
					sepLine,
					theirsEnd,
					oursRange:   new vscode.Range(oursStart + 1, 0, sepLine - 1, lines[sepLine - 1]?.length ?? 0),
					theirsRange: new vscode.Range(sepLine + 1,   0, theirsEnd - 1, lines[theirsEnd - 1]?.length ?? 0)
				});
				i = theirsEnd + 1;
				continue;
			}
		}
		i++;
	}
	return blocks;
}

// ---------------------------------------------------------------------------
// Conflict resolution helpers — called by the commands in extension.ts
// ---------------------------------------------------------------------------

export async function resolveConflict(
	uri: vscode.Uri,
	block: ConflictBlock,
	resolution: 'ours' | 'theirs' | 'both' | '3way'
): Promise<void> {
	if (resolution === '3way') {
		// Delegate to VS Code's built-in merge editor
		await vscode.commands.executeCommand('merge-conflict.accept.all-both', uri);
		return;
	}

	const document = await vscode.workspace.openTextDocument(uri);
	const edit     = new vscode.WorkspaceEdit();

	const fullBlockRange = new vscode.Range(
		block.oursStart, 0,
		block.theirsEnd, document.lineAt(block.theirsEnd).range.end.character + 1
	);

	let replacement: string;
	if (resolution === 'ours') {
		replacement = extractLines(document, block.oursStart + 1, block.sepLine - 1);
	} else if (resolution === 'theirs') {
		replacement = extractLines(document, block.sepLine + 1, block.theirsEnd - 1);
	} else {
		// both
		replacement =
			extractLines(document, block.oursStart + 1, block.sepLine - 1) +
			extractLines(document, block.sepLine + 1, block.theirsEnd - 1);
	}

	edit.replace(uri, fullBlockRange, replacement);
	await vscode.workspace.applyEdit(edit);

	// Check if all conflicts are resolved
	const updatedDoc = await vscode.workspace.openTextDocument(uri);
	if (!updatedDoc.getText().includes('<<<<<<<')) {
		const action = await vscode.window.showInformationMessage(
			'Macide: All conflicts resolved — Stage file?',
			'Stage',
			'Not now'
		);
		if (action === 'Stage') {
			await vscode.commands.executeCommand('git.stage', uri);
		}
	}
}

function extractLines(document: vscode.TextDocument, startLine: number, endLine: number): string {
	if (startLine > endLine) return '';
	let result = '';
	for (let l = startLine; l <= endLine && l < document.lineCount; l++) {
		result += document.lineAt(l).text + '\n';
	}
	return result;
}
