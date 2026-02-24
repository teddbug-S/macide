/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Git HTTPS Credential Bridge.
 * Intercepts Git credential requests and resolves them from the token vault,
 * automatically routing pushes/pulls/fetches through the correct GitHub account.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as https from 'https';
import type { AccountManager } from '../accounts/manager';
import type { NotificationService } from '../ui/notifications/notificationService';
import type { MacideAccount } from '../accounts/manager';

const GITHUB_HTTPS_RE  = /^https?:\/\/(?:[^@]+@)?github\.com\//;
const OWNER_REPO_RE    = /^https?:\/\/(?:[^@]+@)?github\.com\/([^/]+)\/([^/.]+)/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fire a lightweight GET /repos/{owner}/{repo} to check read access. */
function canAccessRepo(token: string, owner: string, repo: string): Promise<boolean> {
	return new Promise(resolve => {
		const options = {
			hostname: 'api.github.com',
			path:     `/repos/${owner}/${repo}`,
			method:   'GET',
			headers:  {
				'Authorization': `token ${token}`,
				'User-Agent':    'Macide/1.0',
				'Accept':        'application/vnd.github.v3+json'
			}
		};

		const req = https.request(options, res => {
			// Drain the body so the socket can be reused
			res.resume();
			// 200 = accessible; 404 = exists but no access (or not found); 403 = forbidden
			resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300);
		});
		req.on('error', () => resolve(false));
		req.setTimeout(5000, () => { req.destroy(); resolve(false); });
		req.end();
	});
}

// ---------------------------------------------------------------------------
// CredentialBridge
// ---------------------------------------------------------------------------

export class CredentialBridge implements vscode.Disposable {
	private _disposables: vscode.Disposable[] = [];

	constructor(
		private readonly accountManager: AccountManager,
		private readonly notifications: NotificationService
	) {}

	/**
	 * Resolves credentials for a given Git remote URL.
	 * Returns { username, password } where password is `x-access-token:<token>`.
	 * Returns null if we cannot resolve (fall through to Git's own prompt).
	 */
	async resolveCredentials(remoteUrl: string): Promise<{ username: string; password: string } | null> {
		if (!GITHUB_HTTPS_RE.test(remoteUrl)) return null;

		const active = this.accountManager.getActive();
		if (!active) return null;

		return {
			username: active.githubUsername,
			password: `x-access-token:${active.token}`
		};
	}

	/**
	 * Checks if the remote URL belongs to a different stored account than the active one.
	 * Tries each stored account's token against GET /repos/{owner}/{repo}.
	 * If a non-active account has access, prompts the user to switch.
	 * Returns true if a switch was performed.
	 */
	async checkCrossAccountRemote(remoteUrl: string): Promise<boolean> {
		if (!GITHUB_HTTPS_RE.test(remoteUrl)) return false;

		const match = OWNER_REPO_RE.exec(remoteUrl);
		if (!match) return false;

		const [, owner, repo] = match;

		const active  = this.accountManager.getActive();
		const all     = this.accountManager.getAll();
		if (all.length <= 1) return false;

		// Check non-active accounts in parallel
		const candidates: MacideAccount[] = [];
		await Promise.all(
			all
				.filter(a => a.id !== active?.id)
				.map(async a => {
					const ok = await canAccessRepo(a.token, owner, repo);
					if (ok) candidates.push(a);
				})
		);

		if (!candidates.length) return false;

		// Prefer the first matching candidate
		const candidate = candidates[0];

		const action = await vscode.window.showInformationMessage(
			`Macide: The remote "${owner}/${repo}" is accessible via account "${candidate.alias}" (@${candidate.githubUsername}). Switch to it now?`,
			'Switch', 'Keep Current'
		);

		if (action !== 'Switch') return false;

		await this.accountManager.setActive(candidate);
		this.notifications.info(`Switched to ${candidate.alias} (@${candidate.githubUsername}) for ${owner}/${repo}.`);
		return true;
	}

	dispose(): void {
		this._disposables.forEach(d => d.dispose());
	}
}
