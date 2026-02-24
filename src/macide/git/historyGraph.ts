/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Floating Git History Graph (spec §7.4).
 *
 * Triggered by: Cmd+Shift+G H  (macide.openGitHistory)
 * A glassmorphic floating panel showing a commit list with visual branch
 * graph lines, hash, message, author, and relative timestamp.
 *
 * Webview → extension messages:
 *   { type: 'loadMore' }
 *   { type: 'copyHash',     hash }
 *   { type: 'createBranch', hash }
 *   { type: 'checkout',     hash }
 *   { type: 'cherryPick',   hash }
 *   { type: 'revert',       hash }
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getActiveRepo, Commit, relativeTime } from './gitApi';

const PAGE_SIZE = 60;

export class GitHistoryPanel implements vscode.Disposable {
	private _panel: vscode.WebviewPanel | undefined;
	private _commits: Commit[] = [];
	private readonly _disposables: vscode.Disposable[] = [];

	open(): void {
		if (this._panel) {
			this._panel.reveal(vscode.ViewColumn.Beside);
			return;
		}

		this._panel = vscode.window.createWebviewPanel(
			'macide.gitHistory',
			'Git History — Macide',
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: []
			}
		);

		this._panel.webview.html = this._buildHtml(this._panel.webview, []);
		this._panel.onDidDispose(() => { this._panel = undefined; }, undefined, this._disposables);
		this._panel.webview.onDidReceiveMessage(
			(msg: any) => this._handleMessage(msg),
			undefined, this._disposables
		);

		this._loadPage(0);
	}

	private async _loadPage(offset: number): Promise<void> {
		const repo = getActiveRepo();
		if (!repo) {
			this._panel?.webview.postMessage({ type: 'error', message: 'No git repository found.' });
			return;
		}

		try {
			const fresh = await repo.log({ maxEntries: PAGE_SIZE + offset });
			this._commits = fresh;
			this._pushCommits();
		} catch (err) {
			this._panel?.webview.postMessage({
				type: 'error',
				message: `Failed to load history: ${err instanceof Error ? err.message : String(err)}`
			});
		}
	}

	private _pushCommits(): void {
		if (!this._panel) return;
		const payload = this._commits.map(c => ({
			hash:       c.hash.slice(0, 7),
			fullHash:   c.hash,
			message:    c.message.split('\n')[0],
			author:     c.authorName ?? 'Unknown',
			date:       relativeTime(c.authorDate),
			parents:    c.parents.map(p => p.slice(0, 7))
		}));
		this._panel.webview.postMessage({ type: 'commits', commits: payload });
	}

	private async _handleMessage(msg: any): Promise<void> {
		const repo = getActiveRepo();

		switch (msg.type) {
			case 'loadMore':
				await this._loadPage(this._commits.length);
				break;

			case 'copyHash':
				await vscode.env.clipboard.writeText(msg.hash);
				vscode.window.showInformationMessage(`Macide: Copied ${msg.hash}`);
				break;

			case 'createBranch': {
				const name = await vscode.window.showInputBox({
					prompt:      `New branch name from ${msg.hash}`,
					placeHolder: 'feature/my-branch'
				});
				if (name) {
					await vscode.commands.executeCommand('git.branch', name, msg.hash);
				}
				break;
			}

			case 'checkout':
				await vscode.commands.executeCommand('git.checkout', msg.hash);
				break;

			case 'cherryPick':
				if (repo) {
					await vscode.commands.executeCommand('git.cherryPick', msg.hash);
				}
				break;

			case 'revert':
				if (repo) {
					await vscode.commands.executeCommand('git.revert', msg.hash);
				}
				break;
		}
	}

	private _buildHtml(webview: vscode.Webview, _initial: Commit[]): string {
		const nonce = getNonce();
		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Git History</title>
<style nonce="${nonce}">
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  --bg:       #0a0a0f; --s1:#111118; --s2:#16161f; --s3:#1c1c28; --s4:#222235;
  --glass:    rgba(255,255,255,0.04); --border: rgba(255,255,255,0.08);
  --purple:   #7c3aed; --cyan: #06b6d4; --glow: rgba(124,58,237,0.25);
  --text:     #f0f0f5; --sub: #8888a0; --muted: #4a4a60;
  --healthy:  #22c55e; --warning: #f59e0b; --error: #ef4444;
  --ease:     cubic-bezier(0.16,1,0.3,1);
  --dur:      150ms;
}
html,body{background:var(--bg);color:var(--text);font-family:'Geist Sans',-apple-system,'Segoe UI',sans-serif;font-size:13px;line-height:1.5;height:100vh;display:flex;flex-direction:column;overflow:hidden;}

/* toolbar */
.toolbar{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--s2);flex-shrink:0;}
.toolbar-title{font-weight:600;font-size:13px;}
.branch-label{font-size:11px;color:var(--cyan);background:rgba(6,182,212,0.1);padding:2px 8px;border-radius:10px;border:1px solid rgba(6,182,212,0.2);}
.spacer{flex:1;}
.btn-small{background:var(--s3);border:1px solid var(--border);color:var(--sub);font-size:11px;padding:4px 10px;border-radius:5px;cursor:pointer;font-family:inherit;transition:all var(--dur) var(--ease);}
.btn-small:hover{color:var(--text);border-color:rgba(124,58,237,0.4);}

/* commit list */
.commit-list{flex:1;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--s4) transparent;}
.commit-list::-webkit-scrollbar{width:4px;}
.commit-list::-webkit-scrollbar-track{background:transparent;}
.commit-list::-webkit-scrollbar-thumb{background:var(--s4);border-radius:2px;}

.commit-row{display:flex;align-items:flex-start;gap:0;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;transition:background var(--dur) var(--ease);position:relative;}
.commit-row:hover{background:var(--glass);}
.commit-row.selected{background:rgba(124,58,237,0.08);}

/* graph column */
.graph-col{width:24px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;padding-top:4px;}
.graph-dot{width:8px;height:8px;border-radius:50%;background:var(--purple);border:2px solid var(--bg);flex-shrink:0;z-index:1;}
.graph-line{width:2px;background:rgba(124,58,237,0.3);flex:1;margin-top:2px;}

/* info column */
.commit-info{flex:1;min-width:0;}
.commit-msg{font-size:12px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.commit-meta{display:flex;gap:8px;margin-top:3px;font-size:11px;color:var(--sub);}
.commit-hash{font-family:'Geist Mono','Cascadia Code',monospace;color:var(--purple);font-size:10px;}
.commit-author{color:var(--sub);}
.commit-date{color:var(--muted);}

/* context menu */
.ctx-menu{position:fixed;background:rgba(16,16,24,0.95);backdrop-filter:blur(12px) saturate(180%);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.6);z-index:1000;min-width:180px;padding:4px;display:none;}
.ctx-menu.visible{display:block;}
.ctx-item{padding:7px 12px;font-size:12px;color:var(--text);cursor:pointer;border-radius:4px;transition:background var(--dur);}
.ctx-item:hover{background:var(--glass);}
.ctx-sep{height:1px;background:var(--border);margin:3px 0;}

/* footer */
.footer{padding:8px 14px;border-top:1px solid var(--border);display:flex;justify-content:center;}
.btn-load{background:var(--s3);border:1px solid var(--border);color:var(--sub);font-size:11px;padding:5px 16px;border-radius:5px;cursor:pointer;font-family:inherit;transition:all var(--dur) var(--ease);}
.btn-load:hover{color:var(--text);}

.empty{padding:40px;text-align:center;color:var(--muted);}
.spinner-row{display:flex;justify-content:center;padding:32px 0;}
.spinner{width:20px;height:20px;border:2px solid var(--s3);border-top-color:var(--purple);border-radius:50%;animation:spin 600ms linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}
@media(prefers-reduced-motion:reduce){.spinner{animation-duration:0ms!important;}}
</style>
</head>
<body>
<div class="toolbar">
  <span class="toolbar-title">Git History</span>
  <span class="branch-label" id="branch-label">loading…</span>
  <span class="spacer"></span>
  <button class="btn-small" id="btn-refresh">↻ Refresh</button>
</div>
<div class="commit-list" id="commit-list">
  <div class="spinner-row"><div class="spinner"></div></div>
</div>
<div class="footer">
  <button class="btn-load" id="btn-load-more">Load more</button>
</div>

<div class="ctx-menu" id="ctx-menu">
  <div class="ctx-item" id="ctx-copy">Copy hash</div>
  <div class="ctx-sep"></div>
  <div class="ctx-item" id="ctx-checkout">Checkout</div>
  <div class="ctx-item" id="ctx-branch">Create branch here</div>
  <div class="ctx-item" id="ctx-cherry">Cherry-pick</div>
  <div class="ctx-item" id="ctx-revert">Revert</div>
</div>

<script nonce="${nonce}">
(function(){
  'use strict';
  const vscode   = acquireVsCodeApi();
  const listEl   = document.getElementById('commit-list');
  const ctxMenu  = document.getElementById('ctx-menu');
  let _commits   = [];
  let _ctxHash   = null;

  // ── Message handler ───────────────────────────────────────────────────────
  window.addEventListener('message', function(ev){
    const msg = ev.data;
    if (msg.type === 'commits') {
      _commits = msg.commits;
      render();
    } else if (msg.type === 'error') {
      listEl.innerHTML = '<div class="empty">' + esc(msg.message) + '</div>';
    }
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  function render(){
    if (!_commits.length) {
      listEl.innerHTML = '<div class="empty">No commits found.</div>';
      return;
    }
    listEl.innerHTML = '';
    _commits.forEach(function(c, idx){
      const row = document.createElement('div');
      row.className = 'commit-row';
      row.dataset.hash = c.fullHash;
      row.innerHTML =
        '<div class="graph-col">' +
          '<div class="graph-dot"></div>' +
          (idx < _commits.length - 1 ? '<div class="graph-line"></div>' : '') +
        '</div>' +
        '<div class="commit-info">' +
          '<div class="commit-msg">' + esc(c.message) + '</div>' +
          '<div class="commit-meta">' +
            '<span class="commit-hash">' + esc(c.hash) + '</span>' +
            '<span class="commit-author">' + esc(c.author) + '</span>' +
            '<span class="commit-date">' + esc(c.date) + '</span>' +
          '</div>' +
        '</div>';

      row.addEventListener('contextmenu', function(e){
        e.preventDefault();
        _ctxHash = c.fullHash;
        ctxMenu.style.left = e.clientX + 'px';
        ctxMenu.style.top  = e.clientY + 'px';
        ctxMenu.classList.add('visible');
      });

      listEl.appendChild(row);
    });
  }

  // ── Context menu ───────────────────────────────────────────────────────────
  document.addEventListener('click', function(){ ctxMenu.classList.remove('visible'); });
  document.getElementById('ctx-copy').addEventListener('click',     function(){ post('copyHash',     _ctxHash); });
  document.getElementById('ctx-checkout').addEventListener('click', function(){ post('checkout',     _ctxHash); });
  document.getElementById('ctx-branch').addEventListener('click',   function(){ post('createBranch', _ctxHash); });
  document.getElementById('ctx-cherry').addEventListener('click',   function(){ post('cherryPick',   _ctxHash); });
  document.getElementById('ctx-revert').addEventListener('click',   function(){ post('revert',       _ctxHash); });

  // ── Buttons ────────────────────────────────────────────────────────────────
  document.getElementById('btn-refresh').addEventListener('click',   function(){ vscode.postMessage({ type:'loadMore' }); });
  document.getElementById('btn-load-more').addEventListener('click', function(){ vscode.postMessage({ type:'loadMore' }); });

  function post(type, hash){ if(hash) vscode.postMessage({ type, hash }); }
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
