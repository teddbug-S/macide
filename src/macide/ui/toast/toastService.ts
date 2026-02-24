/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Toast Notification Service — M6 implementation.
 *
 * Architecture:
 *   • `ToastService` manages a capped FIFO queue of up to 3 live toasts.
 *   • Each toast is rendered in a dedicated `WebviewView` registered under
 *     the "macide.toastView" view ID (panel area, bottom).
 *   • While VS Code doesn't support true floating overlays from extension
 *     code, the webview panel in the bottom area gives an approximation.
 *     Electron-level CSS patches (applied via the build) will position it
 *     as a true bottom-right overlay in the final product.
 *
 * Toast types:
 *   info    ($(info)     cyan)   — auto-dismiss 3 s
 *   warning ($(warning)  amber)  — auto-dismiss 5 s
 *   error   ($(error)    red)    — no auto-dismiss
 *
 * Design: Obsidian Flow glassmorphism, stacked 8px apart, ease-out-expo.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { cssVars, COLOR, FONT } from '../../theme/tokens';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type ToastType = 'info' | 'warning' | 'error';

export interface ToastOptions {
	type?:    ToastType;
	/** Auto-dismiss timeout override in ms. Pass 0 for no auto-dismiss. */
	timeout?: number;
	/** Optional action button shown on the right. */
	action?:  { label: string; callback: () => void };
}

export interface Toast {
	id:      string;
	type:    ToastType;
	message: string;
	timeout: number;   // 0 = no auto-dismiss
}

const DEFAULTS: Record<ToastType, number> = {
	info:    3000,
	warning: 5000,
	error:   0
};

const MAX_TOASTS = 3;

// ---------------------------------------------------------------------------
// ToastService
// ---------------------------------------------------------------------------

export class ToastService implements vscode.WebviewViewProvider, vscode.Disposable {
	static readonly VIEW_ID = 'macide.toastView';

	private _queue:   Toast[] = [];
	private _view:    vscode.WebviewView | undefined;
	private _timers   = new Map<string, ReturnType<typeof setTimeout>>();
	private _actions  = new Map<string, () => void>();
	private readonly _disposables: vscode.Disposable[] = [];

	constructor(context: vscode.ExtensionContext) {
		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider(ToastService.VIEW_ID, this, {
				webviewOptions: { retainContextWhenHidden: true }
			})
		);
	}

	// ── WebviewViewProvider ──────────────────────────────────────────────────

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context:    vscode.WebviewViewResolveContext,
		_token:      vscode.CancellationToken
	): void {
		this._view = webviewView;

		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html    = this._buildHtml(webviewView.webview);

		webviewView.webview.onDidReceiveMessage((msg: any) => {
			if (msg.type === 'dismiss') {
				this._dismiss(msg.id);
			} else if (msg.type === 'action') {
				const cb = this._actions.get(msg.id);
				if (cb) { cb(); this._dismiss(msg.id); }
			}
		}, undefined, this._disposables);

		// Push current queue state into the new webview
		this._syncView();
	}

	// ── Public toast methods ─────────────────────────────────────────────────

	show(message: string, options: ToastOptions = {}): string {
		const type    = options.type    ?? 'info';
		const timeout = options.timeout ?? DEFAULTS[type];
		const id      = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

		const toast: Toast = { id, type, message, timeout };

		if (options.action) {
			this._actions.set(id, options.action.callback);
		}

		// Enforce cap — remove oldest if at limit
		if (this._queue.length >= MAX_TOASTS) {
			const oldest = this._queue.shift()!;
			this._clearTimer(oldest.id);
			this._actions.delete(oldest.id);
		}

		this._queue.push(toast);
		this._syncView();

		if (timeout > 0) {
			this._timers.set(id, setTimeout(() => this._dismiss(id), timeout));
		}

		// Reveal the panel so toasts are visible (if panel is the view container)
		if (this._view) {
			this._view.show(true /* preserveFocus */);
		}

		return id;
	}

	/** Convenience shortcuts */
	info   (message: string, action?: { label: string; callback: () => void }): string {
		return this.show(message, { type: 'info',    action });
	}
	warning(message: string, action?: { label: string; callback: () => void }): string {
		return this.show(message, { type: 'warning', action });
	}
	error  (message: string, action?: { label: string; callback: () => void }): string {
		return this.show(message, { type: 'error',   action });
	}

	dismiss(id: string): void {
		this._dismiss(id);
	}

	clearAll(): void {
		this._queue.forEach(t => this._clearTimer(t.id));
		this._queue = [];
		this._actions.clear();
		this._syncView();
	}

	// ── Internals ────────────────────────────────────────────────────────────

	private _dismiss(id: string): void {
		this._clearTimer(id);
		this._actions.delete(id);
		this._queue = this._queue.filter(t => t.id !== id);
		this._syncView();
	}

	private _clearTimer(id: string): void {
		const t = this._timers.get(id);
		if (t !== undefined) { clearTimeout(t); this._timers.delete(id); }
	}

	private _syncView(): void {
		if (!this._view) return;
		this._view.webview.postMessage({
			type:   'update',
			toasts: this._queue.map(t => ({
				id:         t.id,
				type:       t.type,
				message:    t.message,
				hasAction:  this._actions.has(t.id),
				// We can't pass function refs; we stored them in _actions
				actionLabel: undefined as string | undefined
			}))
		});
	}

	private _buildHtml(_webview: vscode.Webview): string {
		const nonce = getNonce();
		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Toasts</title>
<style nonce="${nonce}">
${cssVars()}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html,body{background:transparent;font-family:var(--font-sans);font-size:12px;overflow:hidden;}
.container{display:flex;flex-direction:column;gap:8px;padding:8px;pointer-events:none;}
.toast{
  background:${COLOR.GLASS_BG};
  backdrop-filter:blur(12px) saturate(180%);
  -webkit-backdrop-filter:blur(12px) saturate(180%);
  border:1px solid var(--border);
  border-radius:10px;
  box-shadow:0 8px 32px rgba(0,0,0,0.55),0 0 0 1px rgba(255,255,255,0.04);
  padding:10px 12px;
  display:flex;align-items:flex-start;gap:10px;
  pointer-events:all;
  animation:slide-in var(--dur-medium) var(--ease) both;
  position:relative;
  overflow:hidden;
}
@keyframes slide-in{
  from{opacity:0;transform:translateX(16px) scale(0.97);}
  to{opacity:1;transform:none;}
}
.toast.removing{animation:slide-out var(--dur-short) var(--ease) both;}
@keyframes slide-out{
  to{opacity:0;transform:translateX(16px) scale(0.97);}
}
.toast-icon{font-size:14px;line-height:1;flex-shrink:0;margin-top:1px;}
.toast-info    .toast-icon{color:var(--cyan);}
.toast-warning .toast-icon{color:var(--warning);}
.toast-error   .toast-icon{color:var(--error);}
/* left accent bar */
.toast::before{
  content:'';position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:10px 0 0 10px;
}
.toast-info::before   {background:var(--cyan);}
.toast-warning::before{background:var(--warning);}
.toast-error::before  {background:var(--error);}
.toast-body{flex:1;min-width:0;}
.toast-msg{color:var(--text);line-height:1.45;word-break:break-word;}
.toast-actions{display:flex;gap:6px;margin-top:7px;}
.btn-action{background:var(--s3);border:1px solid var(--border);color:var(--text);font-size:11px;padding:3px 9px;border-radius:5px;cursor:pointer;font-family:var(--font-sans);transition:background var(--dur-micro);}
.btn-action:hover{background:var(--s4);}
.btn-dismiss{background:none;border:none;color:var(--muted);font-size:14px;cursor:pointer;padding:0;line-height:1;flex-shrink:0;transition:color var(--dur-micro);}
.btn-dismiss:hover{color:var(--sub);}
.progress{position:absolute;bottom:0;left:0;height:2px;border-radius:0 0 0 10px;
  background:linear-gradient(to right,var(--purple),var(--cyan));
  transform-origin:left;
}
.toast-info    .progress{background:var(--cyan);}
.toast-warning .progress{background:var(--warning);}
.toast-error   .progress{display:none;}
</style>
</head>
<body>
<div class="container" id="container"></div>
<script nonce="${nonce}">
(function(){
'use strict';
const vscode    = acquireVsCodeApi();
const container = document.getElementById('container');
const _timers   = {};
const ICONS     = { info:'ℹ', warning:'⚠', error:'✕' };

window.addEventListener('message', function(ev){
  const msg = ev.data;
  if (msg.type === 'update') render(msg.toasts);
});

function render(toasts){
  const curIds = new Set(toasts.map(function(t){ return t.id; }));
  // Remove stale DOM toasts
  Array.from(container.querySelectorAll('.toast')).forEach(function(el){
    if (!curIds.has(el.dataset.id)){
      dismiss(el);
    }
  });
  // Add new ones
  toasts.forEach(function(t){
    if (!container.querySelector('[data-id="' + t.id + '"]')){
      addToast(t);
    }
  });
}

function addToast(t){
  const el = document.createElement('div');
  el.className = 'toast toast-' + t.type;
  el.dataset.id = t.id;

  let actHtml = '';
  if (t.hasAction){
    actHtml = '<div class="toast-actions"><button class="btn-action" data-action="' + esc(t.id) + '">' + esc(t.actionLabel || 'Action') + '</button></div>';
  }

  el.innerHTML =
    '<span class="toast-icon">' + ICONS[t.type] + '</span>' +
    '<div class="toast-body"><div class="toast-msg">' + esc(t.message) + '</div>' + actHtml + '</div>' +
    '<button class="btn-dismiss" title="Dismiss">✕</button>' +
    '<div class="progress" id="prog-' + t.id + '"></div>';

  el.querySelector('.btn-dismiss').addEventListener('click', function(){
    vscode.postMessage({ type:'dismiss', id: t.id });
    dismiss(el);
  });
  if (t.hasAction){
    el.querySelector('.btn-action').addEventListener('click', function(){
      vscode.postMessage({ type:'action', id: t.id });
      dismiss(el);
    });
  }

  container.appendChild(el);
}

function dismiss(el){
  if (el.classList.contains('removing')) return;
  el.classList.add('removing');
  el.addEventListener('animationend', function(){ el.remove(); }, { once: true });
}

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
}());
</script>
</body>
</html>`;
	}

	dispose(): void {
		this._timers.forEach(t => clearTimeout(t));
		this._disposables.forEach(d => d.dispose());
	}
}

function getNonce(): string {
	let t = '';
	const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) t += c.charAt(Math.floor(Math.random() * c.length));
	return t;
}
