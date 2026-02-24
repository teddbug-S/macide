/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Account Panel — Glassmorphic floating webview panel.
 *
 * Spec §5.4: 380px wide, Obsidian Flow glass design.
 * State flows:
 *   extension → webview : { type:'update', accounts, activeId }
 *   webview → extension : { type:'switchAccount', accountId }
 *                         { type:'addAccount' }
 *                         { type:'removeAccount', accountId }
 *                         { type:'renameAccount', accountId, alias }
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { MacideAccount } from '../../auth/provider';
import { AccountManager } from '../../accounts/manager';

// ---------------------------------------------------------------------------
// Message types (extension ↔ webview)
// ---------------------------------------------------------------------------

export type ToWebview =
	| { type: 'update'; accounts: MacideAccount[]; activeId: string | undefined }
	| { type: 'clearAlias'; accountId: string };

export type FromWebview =
	| { type: 'switchAccount'; accountId: string }
	| { type: 'addAccount' }
	| { type: 'removeAccount'; accountId: string }
	| { type: 'renameAccount'; accountId: string; alias: string };

// ---------------------------------------------------------------------------
// AccountPanelProvider
// ---------------------------------------------------------------------------

export class AccountPanelProvider implements vscode.Disposable {
	private _panel: vscode.WebviewPanel | undefined;
	private readonly _disposables: vscode.Disposable[] = [];

	constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _accountManager: AccountManager,
		private readonly _onAddAccount: () => void,
		private readonly _onSwitchAccount: (accountId: string) => void,
		private readonly _onRemoveAccount: (accountId: string) => void,
		private readonly _onRenameAccount: (accountId: string, alias: string) => void
	) {
		// Keep panel in sync whenever accounts change outside of it
		this._disposables.push(
			_accountManager.onDidChangeAccounts(() => this._pushUpdate()),
			_accountManager.onDidChangeActive(() => this._pushUpdate())
		);
	}

	// -------------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------------

	open(): void {
		if (this._panel) {
			this._panel.reveal(vscode.ViewColumn.Active);
			return;
		}

		this._panel = vscode.window.createWebviewPanel(
			'macide.accountPanel',
			'Accounts — Macide',
			{ viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: []
			}
		);

		this._panel.webview.html = this._renderHtml(this._panel.webview);

		this._panel.webview.onDidReceiveMessage(
			(msg: FromWebview) => this._handleMessage(msg),
			undefined,
			this._disposables
		);

		this._panel.onDidDispose(() => {
			this._panel = undefined;
		}, undefined, this._disposables);

		// Push initial state
		this._pushUpdate();
	}

	/** Called by external code (e.g., after OAuth completes) to refresh panel. */
	refresh(): void {
		this._pushUpdate();
	}

	// -------------------------------------------------------------------------
	// Internal
	// -------------------------------------------------------------------------

	private _pushUpdate(): void {
		if (!this._panel) return;
		const message: ToWebview = {
			type: 'update',
			accounts: this._accountManager.getAll(),
			activeId: this._accountManager.getActive()?.id
		};
		this._panel.webview.postMessage(message);
	}

	private _handleMessage(msg: FromWebview): void {
		switch (msg.type) {
			case 'switchAccount':
				this._onSwitchAccount(msg.accountId);
				break;
			case 'addAccount':
				this._onAddAccount();
				break;
			case 'removeAccount':
				this._onRemoveAccount(msg.accountId);
				break;
			case 'renameAccount':
				this._onRenameAccount(msg.accountId, msg.alias);
				break;
		}
	}

	// -------------------------------------------------------------------------
	// HTML — Obsidian Flow glassmorphic design (§4 / §5.4)
	// -------------------------------------------------------------------------

	private _renderHtml(webview: vscode.Webview): string {
		const nonce = getNonce();
		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           style-src  'nonce-${nonce}';
           script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Accounts</title>
<style nonce="${nonce}">
/* ── Reset & base ─────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg-base:       #0a0a0f;
  --surface-1:     #111118;
  --surface-2:     #16161f;
  --surface-3:     #1c1c28;
  --surface-4:     #222235;
  --glass-fill:    rgba(255,255,255,0.04);
  --glass-border:  rgba(255,255,255,0.08);
  --accent-purple: #7c3aed;
  --accent-cyan:   #06b6d4;
  --accent-glow:   rgba(124,58,237,0.25);
  --text-primary:  #f0f0f5;
  --text-secondary:#8888a0;
  --text-muted:    #4a4a60;
  --text-disabled: #2e2e45;
  --healthy:       #22c55e;
  --warning:       #f59e0b;
  --exhausted:     #ef4444;
  --idle:          #4a4a60;
  --radius-panel:  12px;
  --radius-card:   10px;
  --radius-pill:   8px;
  --radius-btn:    6px;
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-short:     150ms;
  --dur-medium:    220ms;
}

html, body {
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: 'Geist Sans', -apple-system, 'Segoe UI', sans-serif;
  font-size: 13px;
  line-height: 1.5;
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 40px 20px 60px;
}

/* ── Panel ────────────────────────────────────────────────────────────────── */
.panel {
  width: 380px;
  background: rgba(16,16,24,0.85);
  backdrop-filter: blur(12px) saturate(180%);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-panel);
  box-shadow:
    0 8px 48px rgba(0,0,0,0.6),
    0 0 0 1px rgba(255,255,255,0.06);
  overflow: hidden;
  animation: panelIn var(--dur-medium) var(--ease-out-expo) both;
}

@keyframes panelIn {
  from { opacity: 0; transform: scale(0.96) translateY(-8px); }
  to   { opacity: 1; transform: scale(1)    translateY(0); }
}

/* ── Header ───────────────────────────────────────────────────────────────── */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 14px;
  border-bottom: 1px solid var(--glass-border);
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.01em;
}

.btn-add {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  background: linear-gradient(135deg, var(--accent-purple), var(--accent-cyan));
  border: none;
  border-radius: var(--radius-btn);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity var(--dur-short) var(--ease-out-expo),
              transform var(--dur-short) var(--ease-out-expo);
}
.btn-add:hover  { opacity: 0.9; transform: translateY(-1px); }
.btn-add:active { opacity: 1;   transform: translateY(0); }
.btn-add svg { flex-shrink: 0; }

/* ── Account list ─────────────────────────────────────────────────────────── */
.account-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  max-height: calc(80vh - 120px);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--surface-4) transparent;
}
.account-list::-webkit-scrollbar       { width: 4px; }
.account-list::-webkit-scrollbar-track { background: transparent; }
.account-list::-webkit-scrollbar-thumb { background: var(--surface-4); border-radius: 2px; }

.empty-state {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.7;
}
.empty-state strong {
  display: block;
  color: var(--text-secondary);
  font-weight: 500;
  margin-bottom: 6px;
}

/* ── Account card ─────────────────────────────────────────────────────────── */
.account-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--glass-border);
  transition: background var(--dur-short) var(--ease-out-expo);
  position: relative;
}
.account-card:last-child { border-bottom: none; }
.account-card:hover      { background: var(--glass-fill); }
.account-card.active     { background: rgba(124,58,237,0.06); }
.account-card.active::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 2px;
  background: linear-gradient(180deg, var(--accent-purple), var(--accent-cyan));
  border-radius: 0 2px 2px 0;
}

.card-top {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Avatar initial circle */
.avatar {
  flex-shrink: 0;
  width: 36px; height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-purple), var(--accent-cyan));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  text-transform: uppercase;
  position: relative;
}
.avatar .status-dot {
  position: absolute;
  bottom: 0; right: 0;
  width: 10px; height: 10px;
  border-radius: 50%;
  border: 2px solid var(--surface-1);
}
.status-dot.healthy   { background: var(--healthy); }
.status-dot.warning   { background: var(--warning); }
.status-dot.exhausted { background: var(--exhausted); }
.status-dot.idle      { background: var(--idle); }

.card-info {
  flex: 1;
  min-width: 0;
}
.card-alias {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}
.card-alias:hover .edit-icon { opacity: 1; }
.edit-icon {
  opacity: 0;
  transition: opacity var(--dur-short);
  color: var(--text-muted);
  flex-shrink: 0;
}
.card-username {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 1px;
}
.status-badge {
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 3px;
  display: inline-block;
  margin-top: 3px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.status-badge.healthy   { background: rgba(34,197,94,0.15);  color: var(--healthy); }
.status-badge.warning   { background: rgba(245,158,11,0.15); color: var(--warning); }
.status-badge.exhausted { background: rgba(239,68,68,0.15);  color: var(--exhausted); }
.status-badge.idle      { background: rgba(74,74,96,0.20);   color: var(--text-muted); }

.card-actions {
  display: flex;
  gap: 6px;
}
.btn-switch, .btn-active, .btn-remove {
  padding: 4px 10px;
  border-radius: var(--radius-btn);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all var(--dur-short) var(--ease-out-expo);
}
.btn-switch {
  background: var(--surface-3);
  color: var(--text-secondary);
  border: 1px solid var(--glass-border);
}
.btn-switch:hover {
  background: var(--surface-4);
  color: var(--text-primary);
  border-color: rgba(124,58,237,0.4);
}
.btn-active {
  background: rgba(124,58,237,0.15);
  color: var(--accent-purple);
  border: 1px solid rgba(124,58,237,0.3);
  cursor: default;
}
.btn-remove {
  background: transparent;
  color: var(--text-muted);
  border: 1px solid transparent;
  padding: 4px 8px;
  margin-left: auto;
}
.btn-remove:hover {
  color: var(--exhausted);
  border-color: rgba(239,68,68,0.3);
  background: rgba(239,68,68,0.08);
}

/* ── Usage bar ────────────────────────────────────────────────────────────── */
.usage-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.usage-bar-track {
  flex: 1;
  height: 4px;
  background: var(--surface-3);
  border-radius: 2px;
  overflow: hidden;
}
.usage-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 400ms var(--ease-out-expo);
}
.usage-bar-fill.low    { background: linear-gradient(90deg, var(--accent-purple), var(--accent-cyan)); }
.usage-bar-fill.medium { background: linear-gradient(90deg, var(--accent-purple), var(--warning)); }
.usage-bar-fill.high   { background: linear-gradient(90deg, var(--warning), var(--exhausted)); }

.usage-label {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  min-width: 54px;
  text-align: right;
}

/* ── Inline alias editor ──────────────────────────────────────────────────── */
.alias-input {
  background: var(--surface-3);
  border: 1px solid rgba(124,58,237,0.5);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  padding: 2px 6px;
  width: 100%;
  outline: none;
}
.alias-input:focus {
  border-color: var(--accent-purple);
  box-shadow: 0 0 0 2px var(--accent-glow);
}

/* ── Footer ───────────────────────────────────────────────────────────────── */
.panel-footer {
  padding: 11px 16px;
  border-top: 1px solid var(--glass-border);
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
.btn-manage {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  padding: 3px 0;
  transition: color var(--dur-short);
  font-family: inherit;
}
.btn-manage:hover { color: var(--text-secondary); }

/* ── Loading spinner ──────────────────────────────────────────────────────── */
.loading {
  display: flex;
  justify-content: center;
  padding: 32px 0;
}
.spinner {
  width: 20px; height: 20px;
  border: 2px solid var(--surface-3);
  border-top-color: var(--accent-purple);
  border-radius: 50%;
  animation: spin 600ms linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  *, .panel, .usage-bar-fill { animation-duration: 0ms !important; transition-duration: 0ms !important; }
}
</style>
</head>
<body>
<div class="panel" id="root">
  <div class="panel-header">
    <span class="panel-title">Accounts</span>
    <button class="btn-add" id="btn-add-account">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      Add Account
    </button>
  </div>
  <div class="account-list" id="account-list">
    <div class="loading"><div class="spinner"></div></div>
  </div>
  <div class="panel-footer">
    <button class="btn-manage" id="btn-manage">Manage Accounts →</button>
  </div>
</div>

<script nonce="${nonce}">
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const listEl = document.getElementById('account-list');

  let _state = { accounts: [], activeId: undefined };

  // ── Render ──────────────────────────────────────────────────────────────────
  function render(state) {
    _state = state;
    const { accounts, activeId } = state;
    listEl.innerHTML = '';

    if (!accounts.length) {
      listEl.innerHTML = \`
        <div class="empty-state">
          <strong>No accounts yet</strong>
          Click "Add Account" to sign in with GitHub<br/>and enable Copilot completions.
        </div>\`;
      return;
    }

    const DAILY_LIMIT = 300;

    accounts.forEach(function(acc) {
      const isActive = acc.id === activeId;
      const initial = (acc.alias || acc.githubUsername || '?')[0].toUpperCase();
      const pct = Math.min(100, Math.round((acc.requestCount / DAILY_LIMIT) * 100));
      const fillClass = pct < 60 ? 'low' : pct < 85 ? 'medium' : 'high';

      const card = document.createElement('div');
      card.className = 'account-card' + (isActive ? ' active' : '');
      card.dataset.id = acc.id;

      card.innerHTML = \`
        <div class="card-top">
          <div class="avatar">
            \${initial}
            <span class="status-dot \${acc.status}"></span>
          </div>
          <div class="card-info">
            <div class="card-alias" data-editing="false" title="Click to rename">
              <span class="alias-text">\${esc(acc.alias)}</span>
              <svg class="edit-icon" width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M7.5 1.5l2 2-6 6H1.5v-2l6-6z" stroke="currentColor"
                      stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="card-username">@\${esc(acc.githubUsername)}</div>
            <span class="status-badge \${acc.status}">\${acc.status}</span>
          </div>
          <div class="card-actions" style="align-self:flex-start;margin-top:2px;">
            \${isActive
              ? '<button class="btn-active">Active</button>'
              : '<button class="btn-switch">Switch</button>'}
            <button class="btn-remove" title="Remove account">✕</button>
          </div>
        </div>
        <div class="usage-row">
          <div class="usage-bar-track">
            <div class="usage-bar-fill \${fillClass}" style="width:\${pct}%"></div>
          </div>
          <span class="usage-label">\${acc.requestCount} / \${DAILY_LIMIT} req</span>
        </div>\`;

      // Switch button
      const switchBtn = card.querySelector('.btn-switch');
      if (switchBtn) {
        switchBtn.addEventListener('click', function() {
          vscode.postMessage({ type: 'switchAccount', accountId: acc.id });
        });
      }

      // Remove button
      card.querySelector('.btn-remove').addEventListener('click', function(e) {
        e.stopPropagation();
        const ok = window.confirm(\`Remove "\${acc.alias}" (@\${acc.githubUsername})?\nYour token will be deleted from the keychain.\`);
        if (ok) vscode.postMessage({ type: 'removeAccount', accountId: acc.id });
      });

      // Inline alias rename on click
      const aliasEl = card.querySelector('.card-alias');
      aliasEl.addEventListener('click', function() {
        if (aliasEl.dataset.editing === 'true') return;
        aliasEl.dataset.editing = 'true';

        const input = document.createElement('input');
        input.className = 'alias-input';
        input.value = acc.alias;

        const textSpan = aliasEl.querySelector('.alias-text');
        aliasEl.insertBefore(input, textSpan);
        textSpan.style.display = 'none';
        aliasEl.querySelector('.edit-icon').style.display = 'none';
        input.focus();
        input.select();

        function commit() {
          const newAlias = input.value.trim();
          if (newAlias && newAlias !== acc.alias) {
            vscode.postMessage({ type: 'renameAccount', accountId: acc.id, alias: newAlias });
          } else {
            textSpan.style.display = '';
            aliasEl.querySelector('.edit-icon').style.display = '';
            input.remove();
            aliasEl.dataset.editing = 'false';
          }
        }

        input.addEventListener('keydown', function(e) {
          if (e.key === 'Enter')  { commit(); }
          if (e.key === 'Escape') {
            textSpan.style.display = '';
            aliasEl.querySelector('.edit-icon').style.display = '';
            input.remove();
            aliasEl.dataset.editing = 'false';
          }
        });
        input.addEventListener('blur', commit);
      });

      listEl.appendChild(card);
    });
  }

  // ── Message handler ─────────────────────────────────────────────────────────
  window.addEventListener('message', function(event) {
    const msg = event.data;
    if (msg.type === 'update') {
      render({ accounts: msg.accounts, activeId: msg.activeId });
    }
  });

  // ── Button wiring ────────────────────────────────────────────────────────────
  document.getElementById('btn-add-account').addEventListener('click', function() {
    vscode.postMessage({ type: 'addAccount' });
  });

  document.getElementById('btn-manage').addEventListener('click', function() {
    vscode.postMessage({ type: 'addAccount' }); // routes to settings in M8
  });

  // ── Escape helper ─────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }
}());
</script>
</body>
</html>`;
	}

	dispose(): void {
		this._panel?.dispose();
		for (const d of this._disposables) d.dispose();
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
