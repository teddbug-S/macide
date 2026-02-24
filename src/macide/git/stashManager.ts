/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Stash Manager (spec §7.9).
 *
 * Glassmorphic webview panel listing all stashes with:
 *   Apply | Pop | Drop | Show Diff    per stash card
 *   "New Stash" button at the top
 *
 * Because the VS Code git extension API v1 doesn't expose stash operations
 * directly, we shell out via child_process to git.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as cp from 'child_process';
import { getActiveRepo } from './gitApi';

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function execGit(args: string[], cwd: string): Promise<string> {
	return new Promise((resolve, reject) => {
		cp.execFile('git', args, { cwd, timeout: 10_000 }, (err: Error | null, stdout: string, stderr: string) => {
			if (err) reject(new Error(stderr || err.message));
			else resolve(stdout);
		});
	});
}

interface StashEntry {
	index:   number;    // 0, 1, 2 …
	refName: string;    // "stash@{0}"
	message: string;    // human description
	date:    string;    // raw date string from git
}

async function listStashes(cwd: string): Promise<StashEntry[]> {
	try {
		// git stash list --format="%gd|%ai|%s"
		const out = await execGit(['stash', 'list', '--format=%gd\x1f%ai\x1f%s'], cwd);
		return out.trim().split('\n').filter(Boolean).map((line, idx) => {
			const [refName, date, ...msgParts] = line.split('\x1f');
			return { index: idx, refName: refName.trim(), message: msgParts.join(' ').trim(), date: date.trim() };
		});
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Webview panel
// ---------------------------------------------------------------------------

export class StashManagerPanel implements vscode.Disposable {
	private _panel: vscode.WebviewPanel | undefined;
	private readonly _disposables: vscode.Disposable[] = [];

	open(): void {
		if (this._panel) {
			this._panel.reveal(vscode.ViewColumn.Beside);
			this._loadStashes();
			return;
		}

		this._panel = vscode.window.createWebviewPanel(
			'macide.stashManager',
			'Stash Manager — Macide',
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: []
			}
		);

		this._panel.webview.html = this._buildHtml(this._panel.webview);

		this._panel.webview.onDidReceiveMessage(
			(msg: any) => this._handleMessage(msg),
			undefined, this._disposables
		);

		this._panel.onDidDispose(() => { this._panel = undefined; }, undefined, this._disposables);

		this._loadStashes();
	}

	private async _loadStashes(): Promise<void> {
		const cwd = this._repoRoot();
		if (!cwd) {
			this._panel?.webview.postMessage({ type: 'error', message: 'No git repository found.' });
			return;
		}
		const stashes = await listStashes(cwd);
		this._panel?.webview.postMessage({ type: 'stashes', stashes });
	}

	private _repoRoot(): string | undefined {
		return getActiveRepo()?.rootUri.fsPath;
	}

	private async _handleMessage(msg: any): Promise<void> {
		const cwd = this._repoRoot();
		if (!cwd) return;

		switch (msg.type) {
			case 'apply':
				await this._run(() => execGit(['stash', 'apply', msg.refName], cwd), `Applied stash ${msg.refName}`);
				break;
			case 'pop':
				await this._run(() => execGit(['stash', 'pop', msg.refName], cwd), `Popped stash ${msg.refName}`);
				break;
			case 'drop':
				await this._run(() => execGit(['stash', 'drop', msg.refName], cwd), `Dropped stash ${msg.refName}`);
				break;
			case 'diff':
				try {
					const diff = await execGit(['stash', 'show', '-p', msg.refName], cwd);
					// Show in a temporary read-only document
					const doc = await vscode.workspace.openTextDocument({
						content: diff,
						language: 'diff'
					});
					await vscode.window.showTextDocument(doc, { preview: true });
				} catch (err) {
					vscode.window.showErrorMessage(`Macide Stash: ${err instanceof Error ? err.message : String(err)}`);
				}
				break;
			case 'new': {
				const message = await vscode.window.showInputBox({
					prompt: 'Stash message (optional)',
					placeHolder: 'WIP: in progress…'
				});
				const args = message ? ['stash', 'push', '-m', message] : ['stash', 'push'];
				await this._run(() => execGit(args, cwd), 'Stash created');
				break;
			}
			case 'refresh':
				await this._loadStashes();
				break;
		}
	}

	private async _run(fn: () => Promise<string>, successMsg: string): Promise<void> {
		try {
			await fn();
			vscode.window.showInformationMessage(`Macide: ${successMsg}`);
			await this._loadStashes();
		} catch (err) {
			vscode.window.showErrorMessage(`Macide Stash: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private _buildHtml(webview: vscode.Webview): string {
		const nonce = getNonce();
		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Stash Manager</title>
<style nonce="${nonce}">
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  --bg:#0a0a0f;--s1:#111118;--s2:#16161f;--s3:#1c1c28;--s4:#222235;
  --glass:rgba(255,255,255,0.04);--border:rgba(255,255,255,0.08);
  --purple:#7c3aed;--cyan:#06b6d4;
  --text:#f0f0f5;--sub:#8888a0;--muted:#4a4a60;--error:#ef4444;
  --ease:cubic-bezier(0.16,1,0.3,1);--dur:150ms;
}
html,body{background:var(--bg);color:var(--text);font-family:'Geist Sans',-apple-system,'Segoe UI',sans-serif;font-size:13px;line-height:1.5;min-height:100vh;display:flex;flex-direction:column;}

.toolbar{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--s2);flex-shrink:0;}
.toolbar-title{font-weight:600;}
.spacer{flex:1;}
.btn{background:linear-gradient(135deg,var(--purple),var(--cyan));border:none;color:#fff;font-size:11px;font-weight:500;padding:5px 12px;border-radius:5px;cursor:pointer;font-family:inherit;transition:opacity var(--dur);}
.btn:hover{opacity:0.88;}
.btn-ghost{background:var(--s3);border:1px solid var(--border);color:var(--sub);font-size:11px;padding:4px 10px;border-radius:5px;cursor:pointer;font-family:inherit;transition:all var(--dur);}
.btn-ghost:hover{color:var(--text);}

.stash-list{flex:1;padding:12px;display:flex;flex-direction:column;gap:10px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--s4) transparent;}
.stash-list::-webkit-scrollbar{width:4px;}
.stash-list::-webkit-scrollbar-track{background:transparent;}
.stash-list::-webkit-scrollbar-thumb{background:var(--s4);border-radius:2px;}

.stash-card{background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;transition:border-color var(--dur);}
.stash-card:hover{border-color:rgba(124,58,237,0.3);}

.card-header{display:flex;align-items:flex-start;gap:12px;}
.stash-index{font-size:11px;color:var(--cyan);font-family:'Geist Mono',monospace;background:rgba(6,182,212,0.1);padding:1px 7px;border-radius:10px;border:1px solid rgba(6,182,212,0.2);flex-shrink:0;margin-top:1px;}
.stash-info{flex:1;min-width:0;}
.stash-msg{font-size:12px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.stash-date{font-size:11px;color:var(--muted);margin-top:2px;}

.card-actions{display:flex;gap:6px;flex-wrap:wrap;}
.act{background:var(--s3);border:1px solid var(--border);color:var(--sub);font-size:11px;padding:4px 10px;border-radius:5px;cursor:pointer;font-family:inherit;transition:all var(--dur);}
.act:hover{color:var(--text);border-color:rgba(124,58,237,0.3);}
.act.danger:hover{color:var(--error);border-color:rgba(239,68,68,0.3);background:rgba(239,68,68,0.06);}

.empty{padding:48px;text-align:center;color:var(--muted);}
.empty strong{display:block;color:var(--sub);margin-bottom:6px;}
.spinner-row{display:flex;justify-content:center;padding:40px;}
.spinner{width:20px;height:20px;border:2px solid var(--s3);border-top-color:var(--purple);border-radius:50%;animation:spin 600ms linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}
@media(prefers-reduced-motion:reduce){.spinner{animation-duration:0ms!important;}}
</style>
</head>
<body>
<div class="toolbar">
  <span class="toolbar-title">Stash Manager</span>
  <span class="spacer"></span>
  <button class="btn-ghost" id="btn-refresh">↻ Refresh</button>
  <button class="btn" id="btn-new">＋ New Stash</button>
</div>
<div class="stash-list" id="stash-list">
  <div class="spinner-row"><div class="spinner"></div></div>
</div>
<script nonce="${nonce}">
(function(){
  'use strict';
  const vscode  = acquireVsCodeApi();
  const listEl  = document.getElementById('stash-list');

  window.addEventListener('message', function(ev){
    const msg = ev.data;
    if (msg.type === 'stashes') render(msg.stashes);
    else if (msg.type === 'error') listEl.innerHTML = '<div class="empty">' + esc(msg.message) + '</div>';
  });

  function render(stashes){
    if (!stashes.length){
      listEl.innerHTML = '<div class="empty"><strong>No stashes</strong>Use ＋ New Stash to save your work in progress.</div>';
      return;
    }
    listEl.innerHTML = '';
    stashes.forEach(function(s){
      const card = document.createElement('div');
      card.className = 'stash-card';
      card.innerHTML =
        '<div class="card-header">' +
          '<span class="stash-index">' + esc(s.refName) + '</span>' +
          '<div class="stash-info">' +
            '<div class="stash-msg">' + esc(s.message) + '</div>' +
            '<div class="stash-date">' + esc(s.date) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="card-actions">' +
          '<button class="act" data-action="apply">Apply</button>' +
          '<button class="act" data-action="pop">Pop</button>' +
          '<button class="act" data-action="diff">Show Diff</button>' +
          '<button class="act danger" data-action="drop">Drop</button>' +
        '</div>';

      card.querySelectorAll('.act').forEach(function(btn){
        btn.addEventListener('click', function(){
          const action = btn.dataset.action;
          if (action === 'drop'){
            if (!confirm('Drop stash "' + s.message + '"?')) return;
          }
          vscode.postMessage({ type: action, refName: s.refName });
        });
      });

      listEl.appendChild(card);
    });
  }

  document.getElementById('btn-refresh').addEventListener('click', function(){ vscode.postMessage({ type:'refresh' }); });
  document.getElementById('btn-new').addEventListener('click',     function(){ vscode.postMessage({ type:'new' }); });

  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
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

function getNonce(): string {
	let t = '';
	const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) t += c.charAt(Math.floor(Math.random() * c.length));
	return t;
}
