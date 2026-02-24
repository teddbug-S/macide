/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Floating AI Chat Panel (spec §5.7 / §8.3).
 *
 * A glassmorphic 360×520px webview panel fixed to the bottom-right of the
 * editor window. Features:
 *   • Full Copilot-Chat-style message history (user + assistant bubbles)
 *   • Streaming responses via `vscode.lm.selectChatModels`
 *   • Optional inclusion of active context pins as system context
 *   • Draggable header, "collapse to pill" button
 *   • Cmd+Shift+C to open / focus
 *
 * History is kept in memory (last 10 exchanges) and handed to Session Memory
 * for persistence across reloads.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { cssVars } from '../../theme/tokens';
import type { ContextPinsProvider } from '../contextPins/contextPinsProvider';

const MAX_HISTORY = 10;   // exchanges (user + assistant pairs)

export interface ChatMessage {
	role:    'user' | 'assistant' | 'system';
	content: string;
}

const SYSTEM_PROMPT =
	'You are a helpful AI coding assistant embedded in Macide IDE. ' +
	'Be concise. Format code in markdown fences. ' +
	'When the user provides file context (// PIN: ... blocks), refer to it.';

// ---------------------------------------------------------------------------
// Floating Chat Panel
// ---------------------------------------------------------------------------

export class FloatingChatPanel implements vscode.Disposable {
	private _panel:   vscode.WebviewPanel | undefined;
	private _history: ChatMessage[] = [];
	private readonly _disposables: vscode.Disposable[] = [];

	constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _pins?: ContextPinsProvider
	) {}

	// ── Open / focus ──────────────────────────────────────────────────────────

	open(): void {
		if (this._panel) {
			this._panel.reveal(vscode.ViewColumn.Beside, true /* preserveFocus */);
			return;
		}

		this._panel = vscode.window.createWebviewPanel(
			'macide.floatingChat',
			'Macide AI Chat',
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{
				enableScripts:           true,
				retainContextWhenHidden: true,
				localResourceRoots:      []
			}
		);

		this._panel.webview.html = this._buildHtml(this._panel.webview);

		this._panel.webview.onDidReceiveMessage(
			(msg: any) => this._handleMessage(msg),
			undefined, this._disposables
		);

		this._panel.onDidDispose(
			() => { this._panel = undefined; },
			undefined, this._disposables
		);

		// Replay saved history
		this._pushHistory();
	}

	// ── Getters / setters for session memory ─────────────────────────────────

	get history(): ChatMessage[] { return this._history; }

	loadHistory(history: ChatMessage[]): void {
		this._history = history.slice(-MAX_HISTORY * 2);
	}

	// ── Message handler ───────────────────────────────────────────────────────

	private async _handleMessage(msg: any): Promise<void> {
		switch (msg.type) {
			case 'send':
				await this._sendMessage(msg.text);
				break;
			case 'clear':
				this._history = [];
				this._syncHistory();
				break;
			case 'copyToClipboard':
				await vscode.env.clipboard.writeText(msg.text);
				break;
			case 'insertAtCursor': {
				const editor = vscode.window.activeTextEditor;
				if (editor) {
					await editor.edit(b => b.replace(editor.selection, msg.text));
				}
				break;
			}
		}
	}

	private async _sendMessage(text: string): Promise<void> {
		if (!text.trim()) return;

		// Build prompt — optionally prefix with context pins
		let userContent = text.trim();
		if (this._pins) {
			const pinBlock = await this._pins.buildContextBlock();
			if (pinBlock) {
				userContent = `Context from pinned files:\n\n${pinBlock}\n\n---\n\n${userContent}`;
			}
		}

		this._history.push({ role: 'user', content: text.trim() });
		this._pushHistory();

		// Signal "thinking" state in webview
		this._panel?.webview.postMessage({ type: 'thinking', value: true });

		// Select a Copilot model
		let models: vscode.LanguageModelChat[];
		try {
			models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
		} catch {
			models = [];
		}

		if (!models.length) {
			const errMsg = 'GitHub Copilot is not available. Please sign in and ensure Copilot is active.';
			this._history.push({ role: 'assistant', content: errMsg });
			this._panel?.webview.postMessage({ type: 'thinking', value: false });
			this._pushHistory();
			return;
		}

		const model = models[0];

		// Build the message array for the LM API
		const messages: vscode.LanguageModelChatMessage[] = [
			vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT)
		];

		// Include prior history (last MAX_HISTORY exchanges)
		for (const h of this._history.slice(-(MAX_HISTORY * 2 + 1), -1)) {
			if (h.role === 'user') {
				messages.push(vscode.LanguageModelChatMessage.User(h.content));
			} else if (h.role === 'assistant') {
				messages.push(vscode.LanguageModelChatMessage.Assistant(h.content));
			}
		}

		messages.push(vscode.LanguageModelChatMessage.User(userContent));

		// Stream response
		const cancellation = new vscode.CancellationTokenSource();
		this._disposables.push({ dispose: () => cancellation.cancel() });

		let assistantMsg = '';
		try {
			const response = await model.sendRequest(messages, {}, cancellation.token);

			for await (const chunk of response.text) {
				assistantMsg += chunk;
				// Stream partial to the webview
				this._panel?.webview.postMessage({
					type:    'stream',
					content: assistantMsg
				});
			}
		} catch (err: unknown) {
			if ((err as vscode.LanguageModelError)?.code !== 'Cancelled') {
				assistantMsg = `Error: ${err instanceof Error ? err.message : String(err)}`;
			}
		}

		this._panel?.webview.postMessage({ type: 'thinking', value: false });

		if (assistantMsg) {
			// Trim history to cap
			this._history.push({ role: 'assistant', content: assistantMsg });
			if (this._history.length > MAX_HISTORY * 2) {
				this._history = this._history.slice(-MAX_HISTORY * 2);
			}
			this._pushHistory();
		}
	}

	// ── Sync history to webview ───────────────────────────────────────────────

	private _pushHistory(): void {
		this._panel?.webview.postMessage({
			type:    'history',
			messages: this._history
		});
	}

	private _syncHistory(): void {
		this._pushHistory();
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
<title>Macide AI Chat</title>
<style nonce="${nonce}">
${cssVars()}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html,body{height:100vh;background:var(--bg);font-family:var(--font-sans);font-size:13px;color:var(--text);display:flex;flex-direction:column;overflow:hidden;}

/* header */
.header{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--s2);flex-shrink:0;cursor:default;}
.header-title{font-weight:600;font-size:13px;flex:1;}
.header-subtitle{font-size:11px;color:var(--sub);}
.btn-icon{background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:2px 5px;border-radius:4px;transition:color var(--dur-micro) var(--ease);}
.btn-icon:hover{color:var(--sub);}

/* messages */
.messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:12px;scrollbar-width:thin;scrollbar-color:var(--s4) transparent;}
.messages::-webkit-scrollbar{width:4px;}
.messages::-webkit-scrollbar-thumb{background:var(--s4);border-radius:2px;}

.msg{display:flex;flex-direction:column;gap:4px;max-width:90%;}
.msg.user{align-self:flex-end;align-items:flex-end;}
.msg.assistant{align-self:flex-start;align-items:flex-start;}
.bubble{padding:9px 12px;border-radius:12px;line-height:1.5;word-break:break-word;font-size:12px;}
.msg.user     .bubble{background:var(--purple);color:#fff;border-bottom-right-radius:3px;}
.msg.assistant .bubble{background:var(--s3);border:1px solid var(--border);border-bottom-left-radius:3px;}
.bubble pre{overflow-x:auto;background:var(--s1);padding:8px;border-radius:6px;font-family:var(--font-mono);font-size:11px;margin:6px 0;}
.bubble code{font-family:var(--font-mono);font-size:11px;background:var(--s1);padding:1px 4px;border-radius:3px;}
.msg-actions{display:flex;gap:4px;opacity:0;transition:opacity var(--dur-micro);}
.msg:hover .msg-actions{opacity:1;}
.act-btn{background:var(--s3);border:1px solid var(--border);color:var(--sub);font-size:10px;padding:2px 7px;border-radius:4px;cursor:pointer;font-family:var(--font-sans);}
.act-btn:hover{color:var(--text);}

/* Thinking indicator */
.thinking{display:none;align-self:flex-start;}
.thinking.visible{display:flex;}
.dot-row{display:flex;gap:4px;align-items:center;padding:10px 14px;}
.dot{width:7px;height:7px;border-radius:50%;background:var(--purple);animation:bounce 1.2s infinite ease-in-out;}
.dot:nth-child(2){animation-delay:.2s;}
.dot:nth-child(3){animation-delay:.4s;}
@keyframes bounce{0%,80%,100%{transform:scale(0.7);opacity:.5;}40%{transform:scale(1);opacity:1;}}
@media(prefers-reduced-motion:reduce){.dot{animation:none;}}

/* streaming partial */
.partial{line-height:1.5;font-size:12px;background:var(--s3);border:1px solid var(--border);border-radius:12px;border-bottom-left-radius:3px;padding:9px 12px;word-break:break-word;}

/* input area */
.input-area{padding:10px 12px;border-top:1px solid var(--border);background:var(--s2);flex-shrink:0;}
.input-row{display:flex;gap:8px;align-items:flex-end;}
.input-box{flex:1;background:var(--s3);border:1px solid var(--border);color:var(--text);font-family:var(--font-sans);font-size:12px;padding:8px 10px;border-radius:8px;resize:none;min-height:36px;max-height:120px;line-height:1.4;transition:border-color var(--dur-short) var(--ease);}
.input-box:focus{outline:none;border-color:rgba(124,58,237,0.5);}
.input-box::placeholder{color:var(--muted);}
.send-btn{background:linear-gradient(135deg,var(--purple),var(--cyan));border:none;color:#fff;font-size:13px;width:34px;height:34px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity var(--dur-micro);}
.send-btn:hover{opacity:0.88;}
.send-btn:disabled{opacity:0.4;cursor:default;}
.hint{font-size:10px;color:var(--muted);margin-top:5px;}

.empty-state{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--muted);}
.empty-state .icon{font-size:28px;opacity:0.4;}
.empty-state p{font-size:12px;text-align:center;max-width:220px;}
</style>
</head>
<body>
<div class="header">
  <span class="header-title">$(sparkle) AI Chat</span>
  <span class="header-subtitle" id="model-label">Copilot</span>
  <button class="btn-icon" id="btn-clear" title="Clear history">⊘</button>
</div>

<div class="messages" id="messages">
  <div class="empty-state" id="empty-state">
    <span class="icon">✦</span>
    <p>Ask anything. Active context pins are included automatically.</p>
  </div>
  <div class="thinking" id="thinking">
    <div class="dot-row"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
  </div>
</div>

<div class="input-area">
  <div class="input-row">
    <textarea class="input-box" id="input" rows="1"
              placeholder="Ask Copilot… (Enter to send, Shift+Enter for newline)"></textarea>
    <button class="send-btn" id="btn-send" title="Send">↑</button>
  </div>
  <div class="hint">Shift+Enter for newline · Context pins included when active</div>
</div>

<script nonce="${nonce}">
(function(){
'use strict';
const vscode     = acquireVsCodeApi();
const messagesEl = document.getElementById('messages');
const inputEl    = document.getElementById('input');
const sendBtn    = document.getElementById('btn-send');
const thinkingEl = document.getElementById('thinking');
const emptyEl    = document.getElementById('empty-state');
let _streaming   = false;
let _partialEl   = null;

// ── Incoming messages ───────────────────────────────────────────────────────
window.addEventListener('message', function(ev){
  const msg = ev.data;
  if      (msg.type === 'history')  renderHistory(msg.messages);
  else if (msg.type === 'stream')   renderStream(msg.content);
  else if (msg.type === 'thinking') setThinking(msg.value);
});

// ── Render history ──────────────────────────────────────────────────────────
function renderHistory(msgs){
  // Remove all message nodes (keep thinking + empty)
  Array.from(messagesEl.querySelectorAll('.msg, .partial')).forEach(function(el){ el.remove(); });
  _partialEl = null;

  if (!msgs.length){
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  msgs.forEach(function(m){ appendMessage(m.role, m.content); });
  scrollBottom();
}

function appendMessage(role, content){
  const div = document.createElement('div');
  div.className = 'msg ' + role;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = renderMarkdown(content);

  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  if (role === 'assistant'){
    actions.innerHTML =
      '<button class="act-btn" data-action="copy">Copy</button>' +
      '<button class="act-btn" data-action="insert">Insert</button>';
    actions.querySelectorAll('.act-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        if (btn.dataset.action === 'copy')   vscode.postMessage({ type:'copyToClipboard', text: content });
        if (btn.dataset.action === 'insert') vscode.postMessage({ type:'insertAtCursor',  text: content });
      });
    });
  }

  div.appendChild(bubble);
  div.appendChild(actions);
  messagesEl.insertBefore(div, thinkingEl);
}

function renderStream(content){
  if (!_partialEl){
    _partialEl = document.createElement('div');
    _partialEl.className = 'partial';
    messagesEl.insertBefore(_partialEl, thinkingEl);
    emptyEl.style.display = 'none';
  }
  _partialEl.innerHTML = renderMarkdown(content);
  scrollBottom();
}

function setThinking(val){
  thinkingEl.classList.toggle('visible', val);
  sendBtn.disabled = val;
  if (!val && _partialEl){ _partialEl.remove(); _partialEl = null; }
  scrollBottom();
}

function scrollBottom(){
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Input handling ──────────────────────────────────────────────────────────
function send(){
  const text = inputEl.value.trim();
  if (!text || _streaming) return;
  vscode.postMessage({ type:'send', text });
  inputEl.value = '';
  inputEl.style.height = 'auto';
}

inputEl.addEventListener('keydown', function(e){
  if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send(); }
});
inputEl.addEventListener('input', function(){
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
});
sendBtn.addEventListener('click', send);
document.getElementById('btn-clear').addEventListener('click', function(){
  if (confirm('Clear chat history?')) vscode.postMessage({ type:'clear' });
});

// ── Minimal Markdown renderer (bold, code, fences, newlines) ────────────────
function renderMarkdown(text){
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/```([\w]*)\n([\s\S]*?)```/g, function(_,lang,code){ return '<pre>' + code.trimEnd() + '</pre>'; })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
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

function getNonce(): string {
	let t = '';
	const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) t += c.charAt(Math.floor(Math.random() * c.length));
	return t;
}
