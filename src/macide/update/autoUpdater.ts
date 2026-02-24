/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Auto-Update System (spec §11.2 / M9).
 *
 * Checks GitHub Releases for a newer version on launch and every 24 hours.
 * Downloads nothing — instead prompts the user to restart so the native
 * VS Code / Electron update mechanism can serve the pre-downloaded update.
 *
 * If MACIDE_UPDATE_URL is set the release feed is fetched from there;
 * otherwise falls back to GitHub Releases (https://api.github.com/repos/…).
 *
 * Release JSON expected shape (GitHub Releases API):
 *   { tag_name: "1.2.3", html_url: "…", body: "…", assets: [{browser_download_url:"…"}] }
 *
 * Status bar item format:
 *   idle:     hidden
 *   checking: $(sync~spin) Checking for updates…
 *   ready:    $(arrow-up) Update ready (1.2.3)    [click → restart]
 *   error:    hidden (silent)
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as https from 'https';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;  // 24 hours
const UPDATE_STATE_KEY  = 'macide.update.availableVersion';

// Set MACIDE_GITHUB_OWNER / MACIDE_GITHUB_REPO env vars or override via settings.
const DEFAULT_OWNER = 'macide-app';
const DEFAULT_REPO  = 'macide';

export interface ReleaseInfo {
	version:   string;
	url:       string;
	notes:     string;
	publishedAt: string;
}

export class AutoUpdater implements vscode.Disposable {
	private readonly _item:        vscode.StatusBarItem;
	private readonly _disposables: vscode.Disposable[] = [];
	private _timer:   ReturnType<typeof setInterval> | undefined;
	private _pending: ReleaseInfo | undefined;

	constructor(private readonly _context: vscode.ExtensionContext) {
		this._item = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Right, 9_500
		);
		this._item.name    = 'Macide Update';
		this._item.command = 'macide.applyUpdate';
		this._item.hide();

		// Restore persisted available version from previous session
		const saved = this._context.globalState.get<ReleaseInfo>(UPDATE_STATE_KEY);
		if (saved && this._isNewer(saved.version)) {
			this._pending = saved;
			this._showReady(saved);
		}
	}

	// ── Start / stop ──────────────────────────────────────────────────────────

	start(): void {
		// First check after 10s (give the window time to paint)
		setTimeout(() => this._check(), 10_000);
		this._timer = setInterval(() => this._check(), CHECK_INTERVAL_MS);
	}

	/** Called by `macide.checkForUpdates` command. */
	async checkNow(): Promise<void> {
		await this._check(true);
	}

	/** Called by `macide.applyUpdate` command. Shows release notes then restarts. */
	async applyUpdate(): Promise<void> {
		if (!this._pending) {
			vscode.window.showInformationMessage('Macide: No update is pending.');
			return;
		}

		const info = this._pending;
		const choice = await vscode.window.showInformationMessage(
			`Macide ${info.version} is ready to install.`,
			{ detail: info.notes ? info.notes.slice(0, 300) + (info.notes.length > 300 ? '…' : '') : '' },
			'Restart to Update',
			'View Release Notes',
			'Later'
		);

		if (choice === 'Restart to Update') {
			vscode.commands.executeCommand('workbench.action.reloadWindow');
		} else if (choice === 'View Release Notes') {
			vscode.env.openExternal(vscode.Uri.parse(info.url));
		}
	}

	/** Called by `macide.dismissUpdate` command. */
	async dismissUpdate(): Promise<void> {
		this._pending = undefined;
		await this._context.globalState.update(UPDATE_STATE_KEY, undefined);
		this._item.hide();
	}

	// ── Internal ──────────────────────────────────────────────────────────────

	private async _check(interactive = false): Promise<void> {
		const cfg = vscode.workspace.getConfiguration('macide.updates');
		if (!cfg.get<boolean>('enabled', true) && !interactive) return;

		if (interactive) {
			this._item.text    = '$(sync~spin) Checking…';
			this._item.tooltip = 'Macide: Checking for updates';
			this._item.show();
		}

		let release: ReleaseInfo | undefined;
		try {
			release = await this._fetchLatestRelease();
		} catch (_err) {
			if (interactive) {
				this._item.hide();
				vscode.window.showWarningMessage('Macide: Could not reach the update server. Check your internet connection.');
			}
			return;
		}

		if (!release) {
			if (interactive) {
				this._item.hide();
				vscode.window.showInformationMessage('Macide is up to date.');
			}
			return;
		}

		if (this._isNewer(release.version)) {
			this._pending = release;
			await this._context.globalState.update(UPDATE_STATE_KEY, release);
			this._showReady(release);
			if (interactive) {
				vscode.window.showInformationMessage(
					`Macide ${release.version} is available!`,
					'Install Now', 'Later'
				).then((choice: string | undefined) => {
					if (choice === 'Install Now') this.applyUpdate();
				});
			}
		} else {
			if (interactive) {
				this._item.hide();
				vscode.window.showInformationMessage(`Macide is up to date (${this._currentVersion()}).`);
			}
		}
	}

	private _showReady(info: ReleaseInfo): void {
		this._item.text    = `$(arrow-up) Update ready (${info.version})`;
		this._item.tooltip = new vscode.MarkdownString(
			`**Macide ${info.version}** is ready to install.\n\nClick to restart and apply.`
		);
		this._item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		this._item.show();
	}

	private async _fetchLatestRelease(): Promise<ReleaseInfo | undefined> {
		const cfg = vscode.workspace.getConfiguration('macide.updates');

		// Allow override via setting or environment variable
		const owner = process.env['MACIDE_GITHUB_OWNER']
			?? cfg.get<string>('githubOwner', DEFAULT_OWNER);
		const repo  = process.env['MACIDE_GITHUB_REPO']
			?? cfg.get<string>('githubRepo', DEFAULT_REPO);

		const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

		const raw = await this._get(url, {
			'User-Agent': 'Macide-Updater/1.0',
			'Accept':     'application/vnd.github+json'
		});

		const data = JSON.parse(raw) as {
			tag_name:     string;
			html_url:     string;
			body?:        string;
			published_at: string;
			message?:     string;
		};

		// GitHub returns { message: "Not Found" } for unknown repos
		if (data.message) return undefined;

		const version = data.tag_name.replace(/^v/, '');
		return {
			version,
			url:         data.html_url,
			notes:       data.body ?? '',
			publishedAt: data.published_at
		};
	}

	private _isNewer(candidate: string): boolean {
		const cur = this._currentVersion();
		return this._semverCompare(candidate, cur) > 0;
	}

	private _currentVersion(): string {
		// VSCodium sets `vscode.version` — use it as the base;
		// look for Macide-specific version in package.json in the extension folder.
		try {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const pkg = require(`${this._context.extensionPath}/package.json`);
			if (pkg?.version) return pkg.version as string;
		} catch { /* ignore */ }
		return vscode.version;
	}

	/** Naive semver comparison: returns >0 if a > b, <0 if a < b, 0 if equal. */
	private _semverCompare(a: string, b: string): number {
		const pa = a.split('.').map(Number);
		const pb = b.split('.').map(Number);
		const len = Math.max(pa.length, pb.length);
		for (let i = 0; i < len; i++) {
			const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
			if (diff !== 0) return diff;
		}
		return 0;
	}

	/** Promisified HTTPS GET. Follows one redirect. */
	private _get(url: string, headers: Record<string, string> = {}): Promise<string> {
		return new Promise((resolve, reject) => {
			const req = https.get(url, { headers }, res => {
				if (res.statusCode === 301 || res.statusCode === 302) {
					if (res.headers.location) {
						this._get(res.headers.location, headers).then(resolve, reject);
						return;
					}
				}
				if ((res.statusCode ?? 0) >= 400) {
					reject(new Error(`HTTP ${res.statusCode}`));
					return;
				}
				let body = '';
				res.setEncoding('utf-8');
				res.on('data', (chunk: string) => { body += chunk; });
				res.on('end',  () => resolve(body));
				res.on('error',  reject);
			});
			req.on('error', reject);
			req.setTimeout(10_000, () => { req.destroy(); reject(new Error('timeout')); });
		});
	}

	dispose(): void {
		clearInterval(this._timer);
		this._item.dispose();
		this._disposables.forEach(d => d.dispose());
	}
}
