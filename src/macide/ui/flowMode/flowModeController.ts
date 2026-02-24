/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Flow Mode Controller (spec §5.10 / §8.5).
 *
 * Trigger: `Cmd+.` / macide.toggleFlowMode
 * Activation:
 *   1. Hides sidebar + panel + status bar
 *   2. Sets a context key `macide.flowMode` so keybindings/when-clauses fire
 *   3. Shows a subtle status bar pill "Flow Mode — Press Cmd+. to exit"
 *   4. Displays a non-blocking info message with a "Exit" action
 * Exit: `Escape`, `Cmd+.` again, or clicking the Exit action
 *
 * The deeper vignette overlay is applied via Electron-level CSS patches
 * in the build step; the TS layer handles only service state and VS Code
 * command orchestration.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const CTX_KEY = 'macide.flowMode';

export class FlowModeController implements vscode.Disposable {
	private _active  = false;
	private readonly _ctx:         vscode.ExtensionContext;
	private readonly _statusItem:  vscode.StatusBarItem;
	private readonly _disposables: vscode.Disposable[] = [];

	constructor(context: vscode.ExtensionContext) {
		this._ctx = context;

		// Status bar indicator shown only while Flow Mode is active (priority 99_999)
		this._statusItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			99_999
		);
		this._statusItem.text    = '$(zap) Flow Mode';
		this._statusItem.tooltip = 'Flow Mode active — press Cmd+. or Esc to exit';
		this._statusItem.command = 'macide.toggleFlowMode';
		this._statusItem.color   = new vscode.ThemeColor('statusBarItem.prominentForeground');
		this._statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');

		// Bind keybinding "Escape" → exit when in flow mode
		this._disposables.push(
			vscode.commands.registerCommand('macide._exitFlowModeEscape', () => {
				if (this._active) this.exit();
			})
		);
	}

	get isActive(): boolean { return this._active; }

	// ── Toggle ────────────────────────────────────────────────────────────────

	async toggle(): Promise<void> {
		if (this._active) {
			await this.exit();
		} else {
			await this.enter();
		}
	}

	async enter(): Promise<void> {
		if (this._active) return;
		this._active = true;

		await Promise.allSettled([
			// Collapse sidebar
			vscode.commands.executeCommand('workbench.action.closeSidebar'),
			// Collapse bottom panel
			vscode.commands.executeCommand('workbench.action.closePanel'),
			// Hide activity bar
			vscode.commands.executeCommand('workbench.action.toggleActivityBarVisibility'),
		]);

		// Set context key so when-clauses and decorations activate
		await vscode.commands.executeCommand('setContext', CTX_KEY, true);

		this._statusItem.show();

		// Persist state across reloads
		this._ctx.globalState.update('macide.flowModeActive', true);

		// Non-blocking toast
		vscode.window.showInformationMessage(
			'Macide: ⚡ Flow Mode activated — sidebar and panel hidden.',
			'Exit Flow Mode'
		).then(action => {
			if (action === 'Exit Flow Mode') this.exit();
		});
	}

	async exit(): Promise<void> {
		if (!this._active) return;
		this._active = false;

		await Promise.allSettled([
			// Restore sidebar
			vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility'),
			// Restore activity bar (toggles back)
			vscode.commands.executeCommand('workbench.action.toggleActivityBarVisibility'),
		]);

		await vscode.commands.executeCommand('setContext', CTX_KEY, false);
		this._statusItem.hide();
		this._ctx.globalState.update('macide.flowModeActive', false);
	}

	/** Restore previous state from globalState (e.g., after extension host restart). */
	restoreState(): void {
		const wasActive = this._ctx.globalState.get<boolean>('macide.flowModeActive', false);
		if (wasActive) {
			// Don't re-collapse everything on startup — just update internal flag + context
			this._active = true;
			this._statusItem.show();
			vscode.commands.executeCommand('setContext', CTX_KEY, true);
		}
	}

	dispose(): void {
		this._statusItem.dispose();
		this._disposables.forEach(d => d.dispose());
	}
}
