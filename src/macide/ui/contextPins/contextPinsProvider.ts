/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Context Pins Panel (spec §5.8 / §8.2).
 *
 * Pins files and code selections as persistent Copilot context. The panel
 * lists all active pins; each pin can be toggled active/inactive.
 *
 * Tree view registered as:   macide.contextPinsView
 * Context key (when active): macide.hasContextPins
 *
 * Commands:
 *   macide.pinToAiContext        — from editor right-click or command palette
 *   macide.unpinFromAiContext    — removes a specific pin
 *   macide.toggleContextPin      — toggle active/inactive
 *   macide.clearContextPins      — remove all
 *   macide.copyPinsToClipboard   — copies all active pin contents
 *
 * Persistence: workspaceState "macide.contextPins"
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const STORE_KEY = 'macide.contextPins';

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface ContextPin {
	id:       string;
	uri:      string;   // file URI string
	label:    string;   // display name
	range?:   { start: [number,number]; end: [number,number] };  // [line,char] pairs
	active:   boolean;
	addedAt:  string;
	/** Cached text content (populated lazily). */
	preview?: string;
}

// ---------------------------------------------------------------------------
// TreeItem
// ---------------------------------------------------------------------------

class PinItem extends vscode.TreeItem {
	constructor(public readonly pin: ContextPin) {
		super(pin.label, vscode.TreeItemCollapsibleState.None);

		this.description = pin.active ? 'active' : 'paused';
		this.tooltip     = new vscode.MarkdownString(
			`**${pin.label}**\n\n${pin.range ? 'Selection pin' : 'File pin'}  \n_Added ${new Date(pin.addedAt).toLocaleDateString()}_`
		);
		this.contextValue = 'contextPin';

		this.iconPath = new vscode.ThemeIcon(
			pin.active
				? (pin.range ? 'symbol-snippet' : 'file')
				: 'circle-slash',
			new vscode.ThemeColor(
				pin.active ? 'gitDecoration.addedResourceForeground' : 'disabledForeground'
			)
		);

		this.command = {
			command:   'macide.toggleContextPin',
			title:     'Toggle pin active',
			arguments: [pin.id]
		};
	}
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class ContextPinsProvider implements vscode.TreeDataProvider<PinItem>, vscode.Disposable {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<PinItem | undefined | void>();
	readonly onDidChangeTreeData          = this._onDidChangeTreeData.event;

	private _pins: ContextPin[] = [];
	private readonly _disposables: vscode.Disposable[] = [];

	constructor(private readonly _context: vscode.ExtensionContext) {
		this._load();
	}

	// ── TreeDataProvider ──────────────────────────────────────────────────────

	getTreeItem(element: PinItem): vscode.TreeItem { return element; }

	getChildren(): PinItem[] {
		return this._pins.map(p => new PinItem(p));
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/** Pin the current editor selection (or whole file). */
	async pinCurrent(editor?: vscode.TextEditor): Promise<void> {
		const ed = editor ?? vscode.window.activeTextEditor;
		if (!ed) {
			vscode.window.showInformationMessage('Macide: Open a file to pin it as context.');
			return;
		}

		const uri      = ed.document.uri.toString();
		const fileName = ed.document.fileName.split('/').pop() ?? 'Untitled';
		const sel      = ed.selection;
		const hasRange = !sel.isEmpty;

		const label = hasRange
			? `${fileName}:${sel.start.line + 1}–${sel.end.line + 1}`
			: fileName;

		// Don't duplicate an identical pin
		const duplicate = this._pins.find(p =>
			p.uri === uri &&
			JSON.stringify(p.range) === JSON.stringify(
				hasRange ? { start: [sel.start.line, sel.start.character], end: [sel.end.line, sel.end.character] } : undefined
			)
		);
		if (duplicate) {
			vscode.window.showInformationMessage(`Macide: "${label}" is already pinned.`);
			return;
		}

		const pin: ContextPin = {
			id:      `pin-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
			uri,
			label,
			range:   hasRange
				? { start: [sel.start.line, sel.start.character], end: [sel.end.line, sel.end.character] }
				: undefined,
			active:  true,
			addedAt: new Date().toISOString()
		};

		this._pins.push(pin);
		await this._save();
		vscode.window.showInformationMessage(`Macide: Pinned "${label}" to AI context.`);
	}

	/** Remove pin by ID. */
	async remove(id: string): Promise<void> {
		this._pins = this._pins.filter(p => p.id !== id);
		await this._save();
	}

	/** Toggle a pin's active state. */
	async toggle(id: string): Promise<void> {
		const pin = this._pins.find(p => p.id === id);
		if (!pin) return;
		pin.active = !pin.active;
		await this._save();
	}

	/** Clear all pins. */
	async clearAll(): Promise<void> {
		const count = this._pins.length;
		if (!count) {
			vscode.window.showInformationMessage('Macide: No context pins to clear.');
			return;
		}
		const confirm = await vscode.window.showWarningMessage(
			`Remove all ${count} context pin${count !== 1 ? 's' : ''}?`,
			{ modal: true }, 'Remove All'
		);
		if (confirm !== 'Remove All') return;
		this._pins = [];
		await this._save();
	}

	/** Returns the text content of all active pins, formatted for a prompt. */
	async buildContextBlock(): Promise<string> {
		const parts: string[] = [];

		for (const pin of this._pins.filter(p => p.active)) {
			try {
				const doc  = await vscode.workspace.openTextDocument(vscode.Uri.parse(pin.uri));
				let text: string;

				if (pin.range) {
					const start = new vscode.Position(pin.range.start[0], pin.range.start[1]);
					const end   = new vscode.Position(pin.range.end[0],   pin.range.end[1]);
					text = doc.getText(new vscode.Range(start, end));
				} else {
					text = doc.getText();
				}

				// Truncate very large files
				if (text.length > 6000) text = text.slice(0, 6000) + '\n// [truncated]';

				parts.push(`// PIN: ${pin.label}\n\`\`\`\n${text}\n\`\`\``);
			} catch {
				// File no longer accessible — skip silently
			}
		}

		return parts.join('\n\n');
	}

	/** Copy active pin contents to clipboard. */
	async copyToClipboard(): Promise<void> {
		const block = await this.buildContextBlock();
		if (!block) {
			vscode.window.showInformationMessage('Macide: No active pins to copy.');
			return;
		}
		await vscode.env.clipboard.writeText(block);
		vscode.window.showInformationMessage(`Macide: Copied ${this._pins.filter(p => p.active).length} pin(s) to clipboard.`);
	}

	get pins(): readonly ContextPin[] { return this._pins; }

	// ── Persistence ───────────────────────────────────────────────────────────

	private _load(): void {
		this._pins = this._context.workspaceState.get<ContextPin[]>(STORE_KEY, []);
		this._setContextKey();
	}

	private async _save(): Promise<void> {
		await this._context.workspaceState.update(STORE_KEY, this._pins);
		this._setContextKey();
		this._onDidChangeTreeData.fire();
	}

	private _setContextKey(): void {
		vscode.commands.executeCommand('setContext', 'macide.hasContextPins', this._pins.length > 0);
	}

	dispose(): void {
		this._onDidChangeTreeData.dispose();
		this._disposables.forEach(d => d.dispose());
	}
}
