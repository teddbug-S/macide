/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Contextual Command Surfacing (spec §8.6).
 *
 * Watches the active editor + workspace state and surfaces relevant Macide
 * commands as a status bar quick-pick badge. Conditions checked:
 *
 *   cursor in function body  →  Explain / Write Tests / Refactor
 *   conflict markers present →  Resolve All / 3-Way Diff
 *   account near/at limit    →  Switch Account
 *   staged / unstaged changes→  Commit with AI Message / View Diff
 *
 * The badge appears in the RIGHT status bar with a "⚡ Suggestions" label.
 * Clicking it opens a filtered QuickPick of context-relevant items.
 *
 * Triggered by:
 *   • cursor position change (debounced 800ms)
 *   • document save
 *   • account state change (via accountManager event)
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { AccountManager } from '../../accounts/manager';

const DEBOUNCE_MS = 800;

interface SurfacedCommand {
	label:       string;
	description: string;
	command:     string;
	args?:       unknown[];
}

export class ContextualSurface implements vscode.Disposable {
	private readonly _item:        vscode.StatusBarItem;
	private readonly _disposables: vscode.Disposable[] = [];
	private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
	private _suggestions:   SurfacedCommand[] = [];

	constructor(
		private readonly _accounts: AccountManager,
		private readonly _assumedLimit: () => number
	) {
		this._item = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Right,
			9_900
		);
		this._item.name    = 'Macide Context Suggestions';
		this._item.command = 'macide.showContextSuggestions';
		this._item.hide();

		this._disposables.push(
			vscode.window.onDidChangeTextEditorSelection(() => this._schedule()),
			vscode.workspace.onDidSaveTextDocument(()     => this._schedule()),
			vscode.window.onDidChangeActiveTextEditor(()  => this._schedule()),
			// Re-run when accounts change
			_accounts.onDidChangeActive(() => this._schedule()),
			_accounts.onDidChangeAccounts(() => this._schedule())
		);

		this._schedule();
	}

	// ── Scheduling & analysis ─────────────────────────────────────────────────

	private _schedule(): void {
		clearTimeout(this._debounceTimer);
		this._debounceTimer = setTimeout(() => this._analyze(), DEBOUNCE_MS);
	}

	private async _analyze(): Promise<void> {
		const suggestions: SurfacedCommand[] = [];
		const editor = vscode.window.activeTextEditor;

		// ── 1. Account near/at limit ────────────────────────────────────────────
		const active = this._accounts.getActive();
		if (active) {
			const limit = this._assumedLimit();
			const pct   = active.requestCount / limit;
			if (active.status === 'exhausted' || pct >= 1.0) {
				suggestions.push({
					label:       '$(warning) Account exhausted',
					description: `${active.alias} hit the daily limit — switch now`,
					command:     'macide.openAccountPanel'
				});
			} else if (pct >= 0.8) {
				suggestions.push({
					label:       '$(warning) Account near limit',
					description: `${active.alias} is at ${Math.round(pct * 100)}% of daily limit`,
					command:     'macide.openAccountPanel'
				});
			}
		}

		if (editor) {
			const doc  = editor.document;
			const text = doc.getText();

			// ── 2. Conflict markers ─────────────────────────────────────────────
			if (text.includes('<<<<<<<')) {
				const conflictCount = (text.match(/^<{7}/gm) ?? []).length;
				suggestions.push(
					{
						label:       '$(git-merge) Resolve conflicts',
						description: `${conflictCount} conflict block${conflictCount !== 1 ? 's' : ''} in this file`,
						command:     'macide.conflict.keepOurs'
					},
					{
						label:       '$(diff) Open 3-Way Diff',
						description: 'View all changes in the merge editor',
						command:     'macide.conflict.open3Way'
					}
				);
			}

			// ── 3. Cursor context (in function / class) ─────────────────────────
			const sym = await this._getSymbolAtCursor(doc, editor.selection.active);
			if (sym) {
				suggestions.push(
					{
						label:       '$(comment) Explain this',
						description: `Explain ${sym.kind}: ${sym.name}`,
						command:     'macide.floatingChat',
						args:        [`Explain the following ${sym.kind} "${sym.name}" in detail:\n\`\`\`\n[see editor]\n\`\`\``]
					},
					{
						label:       '$(beaker) Write tests',
						description: `Generate unit tests for ${sym.name}`,
						command:     'macide.floatingChat',
						args:        [`Write unit tests for the function/method "${sym.name}".`]
					},
					{
						label:       '$(wand) Refactor',
						description: `Refactor ${sym.name} for clarity`,
						command:     'macide.floatingChat',
						args:        [`Refactor "${sym.name}" to be cleaner without changing behaviour.`]
					}
				);
			}

			// ── 4. Uncommitted changes ──────────────────────────────────────────
			const diagnostics = vscode.languages.getDiagnostics(doc.uri);
			const hasErrors   = diagnostics.some(d => d.severity === vscode.DiagnosticSeverity.Error);

			if (!hasErrors) {
				// Lightweight check: does this file have a dirty indicator?
				const isDirty = doc.isDirty;
				if (!isDirty) {
					// Check if any repo has changes (fast: just check manager)
					const gitExt = vscode.extensions.getExtension('vscode.git');
					if (gitExt?.isActive) {
						const api   = gitExt.exports?.getAPI(1);
						const hasChanges = api?.repositories?.some(
							(r: any) => r.state.indexChanges.length || r.state.workingTreeChanges.length
						);
						if (hasChanges) {
							suggestions.push(
								{
									label:       '$(sparkle) AI Commit Message',
									description: 'Generate a commit message for staged changes',
									command:     'macide.generateCommitMessage'
								},
								{
									label:       '$(diff) View Changes',
									description: 'Open the Source Control panel',
									command:     'workbench.view.scm'
								}
							);
						}
					}
				}
			}
		}

		this._suggestions = suggestions;

		if (suggestions.length > 0) {
			this._item.text    = `$(zap) ${suggestions.length} suggestion${suggestions.length !== 1 ? 's' : ''}`;
			this._item.tooltip = suggestions.map(s => `• ${s.label.replace(/\$\([^)]+\) /,'')} — ${s.description}`).join('\n');
			this._item.show();
		} else {
			this._item.hide();
		}
	}

	// ── Show quick-pick ───────────────────────────────────────────────────────

	async show(): Promise<void> {
		if (!this._suggestions.length) {
			vscode.window.showInformationMessage('Macide: No context-specific suggestions right now.');
			return;
		}

		const pick = await vscode.window.showQuickPick(
			this._suggestions.map(s => ({
				...s,
				detail: s.description,
				description: undefined
			})),
			{ placeHolder: 'Macide Suggestions — select an action for your current context' }
		);

		if (!pick) return;

		const args = (pick as any).args as unknown[] | undefined;
		await vscode.commands.executeCommand(
			(pick as any).command,
			...(args ?? [])
		);
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	private async _getSymbolAtCursor(
		doc: vscode.TextDocument,
		position: vscode.Position
	): Promise<{ name: string; kind: string } | undefined> {
		try {
			const symbols: vscode.DocumentSymbol[] | undefined = await vscode.commands.executeCommand(
				'vscode.executeDocumentSymbolProvider', doc.uri
			);
			if (!symbols) return undefined;

			// Find the deepest symbol containing the cursor
			const find = (syms: vscode.DocumentSymbol[]): vscode.DocumentSymbol | undefined => {
				for (const sym of syms) {
					if (sym.range.contains(position)) {
						const deeper = find(sym.children);
						return deeper ?? sym;
					}
				}
				return undefined;
			};

			const sym = find(symbols);
			if (!sym) return undefined;

			const kindName = vscode.SymbolKind[sym.kind]?.toLowerCase() ?? 'symbol';
			// Only surface for code symbols (not modules or files)
			const codeKinds = [
				vscode.SymbolKind.Function,
				vscode.SymbolKind.Method,
				vscode.SymbolKind.Class,
				vscode.SymbolKind.Interface,
				vscode.SymbolKind.Constructor
			];
			if (!codeKinds.includes(sym.kind)) return undefined;

			return { name: sym.name, kind: kindName };
		} catch {
			return undefined;
		}
	}

	dispose(): void {
		clearTimeout(this._debounceTimer);
		this._item.dispose();
		this._disposables.forEach(d => d.dispose());
	}
}
