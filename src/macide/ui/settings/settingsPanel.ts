/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Settings Panel Webview (spec §9.1).
 *
 * Opens with Cmd+, (macide.openSettings).
 * A full-featured 4-tab settings editor:
 *   Accounts  — list + CRUD, usage bars, rotation settings
 *   Appearance — theme, glass, animation, accent, fonts, vignette
 *   Git        — blame, AI commit, credential bridge, mismatch, format
 *   Keybindings — all Macide shortcuts displayed, click to edit in VS Code
 *
 * All changes take effect immediately and are persisted to both
 * VS Code globalState configuration and ~/.macide/macide-config.json.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { cssVars } from '../../theme/tokens';
import type { AccountManager } from '../../accounts/manager';
import type { MacideAccount } from '../../auth/provider';
import type { MacideConfig } from '../../config/macideConfig';

function getNonce(): string {
	let t = '';
	const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) t += c.charAt(Math.floor(Math.random() * c.length));
	return t;
}

// ---------------------------------------------------------------------------
// Keybinding definitions (spec §9.1)
// ---------------------------------------------------------------------------

interface KbEntry {
	action:  string;
	mac:     string;
	win:     string;
	command: string;
}

const KEYBINDINGS: KbEntry[] = [
	{ action: 'Account Switcher',   mac: '⌘⇧A',   win: 'Ctrl+Shift+A', command: 'macide.openAccountPanel' },
	{ action: 'Branch Switcher',    mac: '⌘⇧B',   win: 'Ctrl+Shift+B', command: 'macide.openBranchSwitcher' },
	{ action: 'Git History',        mac: '⌘⇧G H', win: 'Ctrl+Shift+G H', command: 'macide.openGitHistory' },
	{ action: 'Flow Mode',          mac: '⌘.',     win: 'Ctrl+.',       command: 'macide.toggleFlowMode' },
	{ action: 'Floating Chat',      mac: '⌘⇧C',   win: 'Ctrl+Shift+C', command: 'macide.openFloatingChat' },
	{ action: 'Pin to AI Context',  mac: '⌘⇧X',   win: 'Ctrl+Shift+X', command: 'macide.pinToAiContext' },
	{ action: 'AI Commit Message',  mac: '⌘⇧M',   win: 'Ctrl+Shift+M', command: 'macide.generateCommitMessage' },
	{ action: 'Context Suggestions',mac: '⌘⇧K',   win: 'Ctrl+Shift+K', command: 'macide.showContextSuggestions' },
	{ action: 'Inline Diff Actions',mac: '',        win: '',             command: 'macide.showInlineDiffActions' },
	{ action: 'Review AI Change',   mac: '',        win: '',             command: 'macide.reviewInlineChange' },
];

// ---------------------------------------------------------------------------
// SettingsPanel
// ---------------------------------------------------------------------------

export class SettingsPanel implements vscode.Disposable {
	private _panel:   vscode.WebviewPanel | undefined;
	private readonly _disposables: vscode.Disposable[] = [];

	constructor(
		private readonly _context:  vscode.ExtensionContext,
		private readonly _accounts: AccountManager,
		private readonly _config:   MacideConfig
	) {}

	// ── Open / focus ──────────────────────────────────────────────────────────

	open(): void {
		if (this._panel) {
			this._panel.reveal(vscode.ViewColumn.One);
			this._sendInit();
			return;
		}

		this._panel = vscode.window.createWebviewPanel(
			'macide.settings',
			'Macide Settings',
			vscode.ViewColumn.One,
			{
				enableScripts:           true,
				retainContextWhenHidden: true,
				localResourceRoots:      []
			}
		);
		this._panel.iconPath = new vscode.ThemeIcon('settings-gear');
		this._panel.webview.html = this._buildHtml(this._panel.webview);

		this._panel.webview.onDidReceiveMessage(
			(msg: any) => this._handleMessage(msg),
			undefined, this._disposables
		);

		this._panel.onDidDispose(
			() => { this._panel = undefined; },
			undefined, this._disposables
		);

		// Push a fresh init payload once the webview has loaded
		setTimeout(() => this._sendInit(), 200);
	}

	// ── Init payload ──────────────────────────────────────────────────────────

	private _sendInit(): void {
		if (!this._panel) return;
		const cfg  = this._config.getAll();
		const accounts = this._accounts.getAll().map(a => ({
			id:            a.id,
			alias:         a.alias,
			githubUsername: a.githubUsername,
			status:        a.status,
			requestCount:  a.requestCount,
			isActive:      a.id === this._accounts.getActive()?.id
		}));

		// Get list of installed VS Code themes
		const themeExt = vscode.extensions.all
			.flatMap((e: vscode.Extension<any>) => (e.packageJSON?.contributes?.themes ?? []) as any[])
			.map((t: any) => ({ label: t.label ?? t.id, id: t.label ?? t.id }))
			.filter((t: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.id === t.id) === i)
			.slice(0, 60);

		const currentTheme = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme', 'Obsidian Flow');
		const isMac        = process.platform === 'darwin';

		this._panel.webview.postMessage({
			type:        'init',
			cfg,
			accounts,
			themes:      themeExt,
			currentTheme,
			isMac,
			keybindings: KEYBINDINGS,
			dailyLimit:  cfg.accounts.assumedDailyLimit
		});
	}

	// ── Message handler ───────────────────────────────────────────────────────

	private async _handleMessage(msg: any): Promise<void> {
		switch (msg.type) {

			/* ── Accounts ── */
			case 'addAccount':
				await vscode.commands.executeCommand('macide.addAccount');
				this._sendInit();
				break;

			case 'removeAccount': {
				const acc = this._accounts.getAll().find((a: MacideAccount) => a.id === msg.id);
				if (!acc) break;
				const ok = await vscode.window.showWarningMessage(
					`Remove "${acc.alias}"? This will delete the stored token.`,
					{ modal: true }, 'Remove'
				);
				if (ok === 'Remove') {
					await this._accounts.removeAccountById(msg.id);
					this._sendInit();
				}
				break;
			}

			case 'renameAccount': {
				const acc = this._accounts.getAll().find((a: MacideAccount) => a.id === msg.id);
				if (!acc) break;
				acc.alias = msg.alias;
				await this._accounts.updateAccount(acc);
				this._sendInit();
				break;
			}

			case 'switchAccount': {
				const target = this._accounts.getAll().find((a: MacideAccount) => a.id === msg.id);
				if (target) await this._accounts.setActive(target);
				this._sendInit();
				break;
			}

			case 'moveAccount': {
				// Reorder by moving account `id` by `delta` (+1 down, -1 up)
				const all = [...this._accounts.getAll()];
				const idx = all.findIndex(a => a.id === msg.id);
				if (idx < 0) break;
				const newIdx = idx + (msg.delta as number);
				if (newIdx < 0 || newIdx >= all.length) break;
				const [removed] = all.splice(idx, 1);
				all.splice(newIdx, 0, removed);
				await this._accounts.saveAll(all);
				this._sendInit();
				break;
			}

			/* ── Settings ── */
			case 'updateSetting': {
				const { section, field, value } = msg as { section: string | null; field: string; value: unknown };
				if (section) {
					await this._config.setNested(section as any, field as any, value as any);
					this._applyLive(section, field, value);
				} else {
					// Top-level field (e.g. githubClientId)
					await this._config.set(field as any, value as any);
					try {
						await vscode.workspace.getConfiguration().update(
							`macide.${field}`, value, vscode.ConfigurationTarget.Global
						);
					} catch { /* setting may not be registered */ }
				}
				break;
			}

			case 'changeTheme': {
				await vscode.workspace.getConfiguration('workbench').update(
					'colorTheme', msg.theme, vscode.ConfigurationTarget.Global
				);
				break;
			}

			case 'openKeybindings': {
				await vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', msg.command ?? '');
				break;
			}

			case 'openExternalSettings': {
				await vscode.commands.executeCommand('workbench.action.openSettings', msg.query ?? 'macide');
				break;
			}

			case 'copyConfigPath': {
				const p = require('path').join(require('os').homedir(), '.macide', 'macide-config.json');
				await vscode.env.clipboard.writeText(p);
				vscode.window.showInformationMessage(`Macide: Config path copied to clipboard.`);
				break;
			}
		}
	}

	// ── Live application of setting changes ───────────────────────────────────

	private _applyLive(section: string, field: string, value: unknown): void {
		try {
			const key = `macide.${section}.${field}`;
			vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
		} catch { /* setting may not be registered in VS Code */ }

		// Mirror font settings into VS Code's native editor configuration
		if (section === 'appearance') {
			if (field === 'editorFontFamily') {
				vscode.workspace.getConfiguration('editor').update(
					'fontFamily', value as string, vscode.ConfigurationTarget.Global
				).then(undefined, () => undefined);
			}
			if (field === 'editorFontSize') {
				vscode.workspace.getConfiguration('editor').update(
					'fontSize', value as number, vscode.ConfigurationTarget.Global
				).then(undefined, () => undefined);
			}
		}
	}

	// ── HTML ──────────────────────────────────────────────────────────────────

	private _buildHtml(_webview: vscode.Webview): string {
		const nonce = getNonce();
		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Macide Settings</title>
<style nonce="${nonce}">
${cssVars()}
/* ── Reset & base ──────────────────────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html,body{height:100vh;background:var(--bg);font-family:var(--font-sans);font-size:13px;color:var(--text);overflow:hidden;display:flex;flex-direction:column;}

/* ── Tab bar ────────────────────────────────────────────────────────────── */
.tab-bar{display:flex;gap:2px;padding:12px 20px 0;border-bottom:1px solid var(--border);background:var(--s2);flex-shrink:0;user-select:none;}
.tab{padding:8px 18px;border-radius:8px 8px 0 0;font-size:12px;font-weight:500;cursor:pointer;color:var(--muted);border:1px solid transparent;border-bottom:none;transition:color var(--dur-micro) var(--ease), background var(--dur-micro);}
.tab:hover{color:var(--sub);}
.tab.active{background:var(--bg);border-color:var(--border);color:var(--text);}

/* ── Scrollable content area ─────────────────────────────────────────────── */
.content{flex:1;overflow-y:auto;padding:24px 28px;display:flex;flex-direction:column;gap:28px;scrollbar-width:thin;scrollbar-color:var(--s4) transparent;}
.content::-webkit-scrollbar{width:5px;}
.content::-webkit-scrollbar-thumb{background:var(--s4);border-radius:3px;}
.panel{display:none;flex-direction:column;gap:28px;}
.panel.active{display:flex;}

/* ── Section headers ─────────────────────────────────────────────────────── */
.section{display:flex;flex-direction:column;gap:14px;}
.section-title{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding-bottom:8px;border-bottom:1px solid var(--border);}

/* ── Row ─────────────────────────────────────────────────────────────────── */
.row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:30px;}
.row-label{display:flex;flex-direction:column;gap:3px;}
.row-label span{font-size:13px;color:var(--text);}
.row-label small{font-size:11px;color:var(--muted);}
.row-control{flex-shrink:0;}

/* ── Controls ─────────────────────────────────────────────────────────────── */
select,input[type=number],input[type=text]{
  background:var(--s3);border:1px solid var(--border);color:var(--text);
  font-family:var(--font-sans);font-size:12px;padding:6px 10px;border-radius:6px;
  outline:none;transition:border-color var(--dur-micro);min-width:160px;
}
select:focus,input[type=number]:focus,input[type=text]:focus{border-color:rgba(124,58,237,.55);}
select option{background:var(--s2);}

input[type=range]{-webkit-appearance:none;appearance:none;width:180px;height:4px;background:var(--s4);border-radius:2px;outline:none;}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:var(--purple);cursor:pointer;}
input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--purple);cursor:pointer;border:none;}

input[type=color]{width:40px;height:30px;padding:2px 3px;background:var(--s3);border:1px solid var(--border);border-radius:6px;cursor:pointer;}

/* Toggle */
.toggle{position:relative;display:inline-flex;align-items:center;cursor:pointer;gap:10px;}
.toggle input{display:none;}
.toggle-track{width:38px;height:20px;background:var(--s4);border-radius:10px;transition:background var(--dur-micro);}
.toggle input:checked~.toggle-track{background:var(--purple);}
.toggle-thumb{position:absolute;left:3px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform var(--dur-micro);pointer-events:none;}
.toggle input:checked~.toggle-track~.toggle-thumb,.toggle input:checked+.toggle-track+.toggle-thumb{transform:translateX(18px);}

/* Button */
.btn{background:var(--s3);border:1px solid var(--border);color:var(--sub);font-size:12px;padding:6px 14px;border-radius:6px;cursor:pointer;font-family:var(--font-sans);transition:color var(--dur-micro),background var(--dur-micro);}
.btn:hover{color:var(--text);background:var(--s4);}
.btn.primary{background:linear-gradient(135deg,var(--purple),var(--cyan));border-color:transparent;color:#fff;}
.btn.primary:hover{opacity:.88;}
.btn.danger{color:#ef4444;}
.btn.danger:hover{background:rgba(239,68,68,.12);}
.btn.small{padding:4px 10px;font-size:11px;}

/* ── Accounts list ──────────────────────────────────────────────────────── */
.account-list{display:flex;flex-direction:column;gap:10px;}
.account-card{background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;transition:border-color var(--dur-micro);}
.account-card.active-account{border-color:rgba(124,58,237,.5);}
.account-card-header{display:flex;align-items:center;gap:12px;}
.avatar{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--purple),var(--cyan));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;}
.account-info{flex:1;min-width:0;}
.account-alias{font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px;}
.account-alias input{background:transparent;border:none;color:var(--text);font-size:13px;font-weight:500;font-family:var(--font-sans);outline:none;padding:0;width:100%;cursor:text;}
.account-alias input:focus{border-bottom:1px solid rgba(124,58,237,.5);}
.account-username{font-size:11px;color:var(--muted);}
.badge{font-size:9px;padding:2px 6px;border-radius:10px;font-weight:600;letter-spacing:.04em;}
.badge.active{background:rgba(124,58,237,.18);color:var(--purple);}
.badge.healthy{background:rgba(34,197,94,.12);color:#22c55e;}
.badge.warning{background:rgba(234,179,8,.12);color:#eab308;}
.badge.exhausted{background:rgba(239,68,68,.12);color:#ef4444;}
.badge.idle{background:var(--s4);color:var(--muted);}
.account-actions{display:flex;gap:6px;margin-left:auto;flex-shrink:0;}
.usage-row{display:flex;align-items:center;gap:10px;}
.usage-bar-wrap{flex:1;height:4px;background:var(--s4);border-radius:2px;overflow:hidden;}
.usage-bar{height:100%;border-radius:2px;transition:width .4s var(--ease);}
.usage-label{font-size:10px;color:var(--muted);white-space:nowrap;}

/* ── Keybindings table ──────────────────────────────────────────────────── */
.kb-table{width:100%;border-collapse:collapse;}
.kb-table th{text-align:left;font-size:11px;color:var(--muted);font-weight:500;padding:6px 10px;border-bottom:1px solid var(--border);}
.kb-table td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.04);font-size:12px;}
.kb-table tr:last-child td{border-bottom:none;}
.kb-table tr:hover td{background:var(--s2);}
kbd{background:var(--s3);border:1px solid var(--border);padding:2px 6px;border-radius:4px;font-family:var(--font-mono);font-size:11px;}
.kb-edit-btn{background:none;border:1px solid var(--border);color:var(--muted);font-size:10px;padding:2px 8px;border-radius:4px;cursor:pointer;font-family:var(--font-sans);}
.kb-edit-btn:hover{color:var(--text);}

/* ── Theme grid ─────────────────────────────────────────────────────────── */
.theme-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;}
.theme-card{background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;cursor:pointer;font-size:12px;transition:border-color var(--dur-micro);}
.theme-card:hover{border-color:rgba(124,58,237,.4);}
.theme-card.selected{border-color:var(--purple);background:rgba(124,58,237,.1);}

/* ── Range with value display ─────────────────────────────────────────────── */
.range-wrap{display:flex;align-items:center;gap:10px;}
.range-val{font-size:11px;color:var(--muted);min-width:28px;text-align:right;}

/* ── Footer ─────────────────────────────────────────────────────────────── */
.footer{flex-shrink:0;padding:10px 28px;border-top:1px solid var(--border);background:var(--s2);display:flex;align-items:center;gap:14px;font-size:11px;color:var(--muted);}
.footer a{color:var(--purple);text-decoration:none;cursor:pointer;}
.footer a:hover{text-decoration:underline;}
</style>
</head>
<body>

<!-- ── Tab bar ──────────────────────────────────────────────────────────── -->
<div class="tab-bar" id="tabs">
  <div class="tab active" data-panel="accounts">Accounts</div>
  <div class="tab" data-panel="appearance">Appearance</div>
  <div class="tab" data-panel="git">Git</div>
  <div class="tab" data-panel="keybindings">Keybindings</div>
</div>

<!-- ── Content ─────────────────────────────────────────────────────────── -->
<div class="content" id="content">

  <!-- Accounts panel -->
  <div class="panel active" id="panel-accounts">
    <div class="section">
      <div class="section-title">GitHub Accounts</div>
      <div class="account-list" id="account-list"></div>
      <div style="margin-top:6px;">
        <button class="btn primary" id="btn-add-account">+ Add Account</button>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Rotation Settings</div>
      <div class="row">
        <div class="row-label">
          <span>Rotation Strategy</span>
          <small>How accounts are selected when the current one hits a limit.</small>
        </div>
        <div class="row-control">
          <select id="rotationStrategy">
            <option value="round-robin">Round Robin</option>
            <option value="least-used">Least Used</option>
            <option value="manual">Manual Only</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="row-label">
          <span>Auto-Rotation</span>
          <small>Automatically switch on rate limit.</small>
        </div>
        <div class="row-control">
          <label class="toggle">
            <input type="checkbox" id="autoRotation"/>
            <div class="toggle-track"></div>
            <div class="toggle-thumb"></div>
          </label>
        </div>
      </div>
      <div class="row">
        <div class="row-label">
          <span>Assumed Daily Limit</span>
          <small>Approximate Copilot requests per account per day.</small>
        </div>
        <div class="row-control">
          <input type="number" id="assumedDailyLimit" min="1" max="9999" style="width:90px;"/>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">GitHub OAuth Client</div>
      <div class="row">
        <div class="row-label">
          <span>GitHub Client ID</span>
          <small>Register at github.com/settings/developers (Device Flow, no callback needed).</small>
        </div>
        <div class="row-control">
          <input type="text" id="githubClientId" placeholder="e.g. Ov23li…" style="width:220px;"/>
        </div>
      </div>
    </div>
  </div>

  <!-- Appearance panel -->
  <div class="panel" id="panel-appearance">
    <div class="section">
      <div class="section-title">Color Theme</div>
      <div class="theme-grid" id="theme-grid"></div>
    </div>
    <div class="section">
      <div class="section-title">Glassmorphism</div>
      <div class="row">
        <div class="row-label">
          <span>Glass Intensity</span>
          <small>Backdrop blur strength for floating panels.</small>
        </div>
        <div class="row-control range-wrap">
          <input type="range" id="glassmorphismIntensity" min="0" max="100"/>
          <span class="range-val" id="glassmorphismIntensity-val">100</span>
        </div>
      </div>
      <div class="row">
        <div class="row-label">
          <span>Vignette Intensity</span>
          <small>Subtle edge-darkening of the editor area.</small>
        </div>
        <div class="row-control range-wrap">
          <input type="range" id="vignetteIntensity" min="0" max="100"/>
          <span class="range-val" id="vignetteIntensity-val">30</span>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Animation</div>
      <div class="row">
        <div class="row-label">
          <span>Animation Speed</span>
          <small>Controls all Macide panel transitions.</small>
        </div>
        <div class="row-control">
          <select id="animationSpeed">
            <option value="normal">Normal</option>
            <option value="fast">Fast</option>
            <option value="off">Off (Reduced Motion)</option>
          </select>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Colors & Fonts</div>
      <div class="row">
        <div class="row-label">
          <span>Accent Color</span>
          <small>Primary purple used for highlights and active states.</small>
        </div>
        <div class="row-control">
          <input type="color" id="accentColor" value="#7c3aed"/>
        </div>
      </div>
      <div class="row">
        <div class="row-label">
          <span>Editor Font Family</span>
          <small>Monospace font used in the code editor.</small>
        </div>
        <div class="row-control">
          <input type="text" id="editorFontFamily" placeholder="Geist Mono" style="width:180px;"/>
        </div>
      </div>
      <div class="row">
        <div class="row-label">
          <span>Editor Font Size</span>
          <small>Font size in pixels (applies to editor.fontSize).</small>
        </div>
        <div class="row-control">
          <input type="number" id="editorFontSize" min="8" max="32" style="width:80px;"/>
        </div>
      </div>
    </div>
  </div>

  <!-- Git panel -->
  <div class="panel" id="panel-git">
    <div class="section">
      <div class="section-title">Blame Annotations</div>
      <div class="row">
        <div class="row-label">
          <span>Inline Blame Mode</span>
          <small>When and how blame information appears in the editor.</small>
        </div>
        <div class="row-control">
          <select id="inlineBlame">
            <option value="current-line">Current Line Only</option>
            <option value="all-lines">All Lines</option>
            <option value="off">Off</option>
          </select>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">AI Commit Messages</div>
      <div class="row">
        <div class="row-label">
          <span>Enable AI Commit Messages</span>
          <small>Generate commit messages from staged diff using the active Copilot account.</small>
        </div>
        <div class="row-control">
          <label class="toggle">
            <input type="checkbox" id="aiCommitMessages"/>
            <div class="toggle-track"></div>
            <div class="toggle-thumb"></div>
          </label>
        </div>
      </div>
      <div class="row">
        <div class="row-label">
          <span>Commit Format</span>
          <small>Default format for AI-generated commit messages.</small>
        </div>
        <div class="row-control">
          <select id="commitFormat">
            <option value="conventional">Conventional Commits</option>
            <option value="freeform">Freeform</option>
          </select>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Credential Bridge</div>
      <div class="row">
        <div class="row-label">
          <span>Enable Credential Bridge</span>
          <small>Resolve Git HTTPS credentials from stored Macide accounts automatically.</small>
        </div>
        <div class="row-control">
          <label class="toggle">
            <input type="checkbox" id="credentialBridge"/>
            <div class="toggle-track"></div>
            <div class="toggle-thumb"></div>
          </label>
        </div>
      </div>
      <div class="row">
        <div class="row-label">
          <span>Account Mismatch Behavior</span>
          <small>Action when the Git remote belongs to a different account.</small>
        </div>
        <div class="row-control">
          <select id="credentialMismatchBehavior">
            <option value="warn">Warn me</option>
            <option value="auto-switch">Auto-switch Account</option>
            <option value="ignore">Ignore</option>
          </select>
        </div>
      </div>
    </div>
  </div>

  <!-- Keybindings panel -->
  <div class="panel" id="panel-keybindings">
    <div class="section">
      <div class="section-title">Macide Keybindings</div>
      <p style="font-size:12px;color:var(--muted);margin-bottom:4px;">
        Click <strong style="color:var(--sub)">Edit</strong> to open VS Code's keybindings editor for that command.
        Changes apply immediately to your global keybindings.
      </p>
      <table class="kb-table" id="kb-table">
        <thead>
          <tr>
            <th>Action</th>
            <th id="kb-col-shortcut">Shortcut</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="kb-body"></tbody>
      </table>
    </div>
    <div class="section">
      <div class="section-title">Advanced</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn" id="btn-open-settings-json">Open VS Code Settings (JSON)</button>
        <button class="btn" id="btn-copy-config-path">Copy Config File Path</button>
      </div>
    </div>
  </div>
</div>

<!-- ── Footer ─────────────────────────────────────────────────────────── -->
<div class="footer">
  <span>Macide v1.0</span>
  <span>·</span>
  <a id="footer-open-vscode-settings">VS Code Settings</a>
  <span>·</span>
  <a id="footer-copy-config">Config: ~/.macide/macide-config.json</a>
</div>

<script nonce="${nonce}">
(function(){
'use strict';
const vscode = acquireVsCodeApi();
let _cfg = null;
let _isMac = true;

// ── Tabs ──────────────────────────────────────────────────────────────────
document.getElementById('tabs').addEventListener('click', function(e){
  const tab = e.target.closest('.tab');
  if (!tab) return;
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('active'); });
  document.querySelectorAll('.panel').forEach(function(p){ p.classList.remove('active'); });
  tab.classList.add('active');
  const id = 'panel-' + tab.dataset.panel;
  document.getElementById(id).classList.add('active');
});

// ── Incoming messages ─────────────────────────────────────────────────────
window.addEventListener('message', function(ev){
  const msg = ev.data;
  if (msg.type === 'init') init(msg);
});

function init(data){
  _cfg  = data.cfg;
  _isMac = data.isMac;

  renderAccounts(data.accounts, data.dailyLimit);
  renderThemes(data.themes, data.currentTheme);
  renderAppearance(data.cfg.appearance);
  renderRotation(data.cfg);
  renderGit(data.cfg.git);
  renderKeybindings(data.keybindings, data.isMac);
}

// ── Accounts ──────────────────────────────────────────────────────────────
function renderAccounts(accounts, limit){
  const list = document.getElementById('account-list');
  if (!accounts.length){
    list.innerHTML = '<p style="color:var(--muted);font-size:12px;">No accounts added yet.</p>';
    return;
  }
  list.innerHTML = accounts.map(function(a, idx){
    const pct = Math.min(100, Math.round(a.requestCount / limit * 100));
    const barColor = pct >= 90 ? '#ef4444' : pct >= 70 ? '#eab308' : '#22c55e';
    const letter = (a.alias||'?')[0].toUpperCase();
    const isFirst = idx === 0;
    const isLast  = idx === accounts.length - 1;
    return '<div class="account-card' + (a.isActive ? ' active-account' : '') + '" data-id="' + a.id + '">'
      + '<div class="account-card-header">'
      +   '<div class="avatar">' + letter + '</div>'
      +   '<div class="account-info">'
      +     '<div class="account-alias">'
      +       '<input type="text" class="alias-input" value="' + esc(a.alias) + '" data-id="' + a.id + '"/>'
      +       (a.isActive ? '<span class="badge active">Active</span>' : '')
      +       '<span class="badge ' + a.status + '">' + a.status + '</span>'
      +     '</div>'
      +     '<div class="account-username">@' + esc(a.githubUsername) + '</div>'
      +   '</div>'
      +   '<div class="account-actions">'
      +     (!isFirst ? '<button class="btn small" data-action="up" data-id="' + a.id + '" title="Move up">↑</button>' : '')
      +     (!isLast  ? '<button class="btn small" data-action="down" data-id="' + a.id + '" title="Move down">↓</button>' : '')
      +     (!a.isActive ? '<button class="btn small" data-action="switch" data-id="' + a.id + '">Use</button>' : '')
      +     '<button class="btn small danger" data-action="remove" data-id="' + a.id + '">Remove</button>'
      +   '</div>'
      + '</div>'
      + '<div class="usage-row">'
      +   '<div class="usage-bar-wrap"><div class="usage-bar" style="width:' + pct + '%;background:' + barColor + '"></div></div>'
      +   '<span class="usage-label">' + a.requestCount + ' / ' + limit + ' today (' + pct + '%)</span>'
      + '</div>'
      + '</div>';
  }).join('');

  // Alias rename
  list.querySelectorAll('.alias-input').forEach(function(inp){
    inp.addEventListener('change', function(){
      vscode.postMessage({ type:'renameAccount', id: inp.dataset.id, alias: inp.value });
    });
  });

  // Action buttons
  list.querySelectorAll('[data-action]').forEach(function(btn){
    btn.addEventListener('click', function(){
      const action = btn.dataset.action;
      const id     = btn.dataset.id;
      if (action === 'remove') vscode.postMessage({ type:'removeAccount', id });
      if (action === 'switch') vscode.postMessage({ type:'switchAccount', id });
      if (action === 'up')    vscode.postMessage({ type:'moveAccount', id, delta: -1 });
      if (action === 'down')  vscode.postMessage({ type:'moveAccount', id, delta: +1 });
    });
  });
}

document.getElementById('btn-add-account').addEventListener('click', function(){
  vscode.postMessage({ type:'addAccount' });
});

// ── Rotation settings ─────────────────────────────────────────────────────
function renderRotation(cfg){
  setSelect('rotationStrategy',  cfg.accounts.rotationStrategy);
  setCheck('autoRotation',       cfg.accounts.autoRotation);
  setValue('assumedDailyLimit',  cfg.accounts.assumedDailyLimit);
  setValue('githubClientId',     cfg.githubClientId);
}
bindSelect('rotationStrategy',  function(v){ send('accounts','rotationStrategy',v); });
bindCheck('autoRotation',       function(v){ send('accounts','autoRotation',v); });
bindChange('assumedDailyLimit', function(v){ send('accounts','assumedDailyLimit', parseInt(v)||300); });
bindChange('githubClientId',    function(v){ send(null,'githubClientId',v); });

// ── Appearance ────────────────────────────────────────────────────────────
function renderAppearance(app){
  setSelect('animationSpeed',       app.animationSpeed);
  setRange('glassmorphismIntensity', app.glassmorphismIntensity);
  setRange('vignetteIntensity',      app.vignetteIntensity);
  setColorPicker('accentColor',      app.accentColor);
  setValue('editorFontFamily',       app.editorFontFamily);
  setValue('editorFontSize',         app.editorFontSize);
}
bindSelect('animationSpeed', function(v){ send('appearance','animationSpeed',v); });
bindRange('glassmorphismIntensity', function(v){ send('appearance','glassmorphismIntensity',parseInt(v)); });
bindRange('vignetteIntensity',       function(v){ send('appearance','vignetteIntensity',parseInt(v)); });
bindColorPicker('accentColor',       function(v){ send('appearance','accentColor',v); });
bindChange('editorFontFamily', function(v){ send('appearance','editorFontFamily',v); });
bindChange('editorFontSize',   function(v){ send('appearance','editorFontSize', parseInt(v)||13); });

// ── Themes ────────────────────────────────────────────────────────────────
function renderThemes(themes, current){
  const grid = document.getElementById('theme-grid');
  // Always include Obsidian Flow first
  const all = [{ id:'Obsidian Flow', label:'Obsidian Flow' }]
    .concat(themes.filter(function(t){ return t.id !== 'Obsidian Flow'; }));
  grid.innerHTML = all.map(function(t){
    return '<div class="theme-card' + (t.id === current ? ' selected' : '') + '" data-theme="' + esc(t.id) + '">'
      + esc(t.label) + '</div>';
  }).join('');
  grid.querySelectorAll('.theme-card').forEach(function(card){
    card.addEventListener('click', function(){
      grid.querySelectorAll('.theme-card').forEach(function(c){ c.classList.remove('selected'); });
      card.classList.add('selected');
      vscode.postMessage({ type:'changeTheme', theme: card.dataset.theme });
    });
  });
}

// ── Git settings ──────────────────────────────────────────────────────────
function renderGit(git){
  setSelect('inlineBlame',               git.inlineBlame);
  setCheck('aiCommitMessages',           git.aiCommitMessages);
  setSelect('commitFormat',              git.commitFormat);
  setCheck('credentialBridge',           git.credentialBridge);
  setSelect('credentialMismatchBehavior',git.credentialMismatchBehavior);
}
bindSelect('inlineBlame',                function(v){ send('git','inlineBlame',v); });
bindCheck('aiCommitMessages',            function(v){ send('git','aiCommitMessages',v); });
bindSelect('commitFormat',               function(v){ send('git','commitFormat',v); });
bindCheck('credentialBridge',            function(v){ send('git','credentialBridge',v); });
bindSelect('credentialMismatchBehavior', function(v){ send('git','credentialMismatchBehavior',v); });

// ── Keybindings ───────────────────────────────────────────────────────────
function renderKeybindings(kbs, isMac){
  document.getElementById('kb-col-shortcut').textContent = isMac ? 'Mac' : 'Windows / Linux';
  const tbody = document.getElementById('kb-body');
  tbody.innerHTML = kbs.map(function(kb){
    const shortcut = isMac ? kb.mac : kb.win;
    return '<tr>'
      + '<td>' + esc(kb.action) + '</td>'
      + '<td>' + (shortcut ? '<kbd>' + esc(shortcut) + '</kbd>' : '<span style="color:var(--muted)">—</span>') + '</td>'
      + '<td><button class="kb-edit-btn" data-command="' + esc(kb.command) + '">Edit</button></td>'
      + '</tr>';
  }).join('');
  tbody.querySelectorAll('.kb-edit-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      vscode.postMessage({ type:'openKeybindings', command: btn.dataset.command });
    });
  });
}

// ── Footer / advanced ─────────────────────────────────────────────────────
document.getElementById('btn-open-settings-json').addEventListener('click', function(){
  vscode.postMessage({ type:'openExternalSettings', query:'macide' });
});
document.getElementById('btn-copy-config-path').addEventListener('click', function(){
  vscode.postMessage({ type:'copyConfigPath' });
});
document.getElementById('footer-open-vscode-settings').addEventListener('click', function(){
  vscode.postMessage({ type:'openExternalSettings', query:'macide' });
});
document.getElementById('footer-copy-config').addEventListener('click', function(){
  vscode.postMessage({ type:'copyConfigPath' });
});

// ── Helpers ───────────────────────────────────────────────────────────────
function send(section, field, value){
  vscode.postMessage({ type:'updateSetting', section, field, value });
}
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function setSelect(id,v){ const el = document.getElementById(id); if(el) el.value = v; }
function setValue(id,v){ const el = document.getElementById(id); if(el) el.value = v; }
function setCheck(id,v){ const el = document.getElementById(id); if(el) el.checked = !!v; }
function setRange(id,v){ const el = document.getElementById(id); if(el){ el.value = v; const rv = document.getElementById(id+'-val'); if(rv) rv.textContent = v; } }
function setColorPicker(id,v){ const el = document.getElementById(id); if(el) el.value = v; }
function bindSelect(id,cb){ const el = document.getElementById(id); if(el) el.addEventListener('change', function(){ cb(el.value); }); }
function bindCheck(id,cb){ const el = document.getElementById(id); if(el) el.addEventListener('change', function(){ cb(el.checked); }); }
function bindChange(id,cb){ const el = document.getElementById(id); if(el) el.addEventListener('change', function(){ cb(el.value); }); }
function bindRange(id,cb){
  const el = document.getElementById(id);
  const rv = document.getElementById(id+'-val');
  if(!el) return;
  el.addEventListener('input', function(){ if(rv) rv.textContent = el.value; });
  el.addEventListener('change', function(){ cb(el.value); });
}
function bindColorPicker(id,cb){
  const el = document.getElementById(id);
  if(!el) return;
  el.addEventListener('change', function(){ cb(el.value); });
}
}());
</script>
</body>
</html>`;
	}

	dispose(): void {
		this._panel?.dispose();
		this._disposables.forEach(d => d.dispose());
	}
}
