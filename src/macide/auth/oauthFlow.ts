/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * OAuth 2.0 Device Flow — GitHub Device Authorization Grant (RFC 8628).
 *
 * Usage: register a GitHub OAuth App at https://github.com/settings/developers
 *   - Homepage URL: https://github.com/teddbug-S/macide (or your org URL)
 *   - Callback URL: not needed for Device Flow
 *   - Paste the resulting Client ID into the `macide.githubClientId` setting
 *     (or set MACIDE_GITHUB_CLIENT_ID env var at build time).
 *
 * Flow:
 *   1. POST /login/device/code   → device_code + user_code
 *   2. Open verification_uri in browser, show user_code in notification
 *   3. Poll /login/oauth/access_token every `interval` seconds
 *   4. On success → GET /user for profile info
 *   5. Return MacideAccount ready to store in vault
 *--------------------------------------------------------------------------------------------*/

import * as https from 'https';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type { MacideAccount } from './provider';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_API_HOST = 'github.com';
const GITHUB_API_HOST_API = 'api.github.com';

/**
 * Scopes requested from GitHub.
 * `read:user`  — profile info (id, login, avatar_url)
 * `repo`       — credential bridge for HTTPS git operations
 *
 * Note: "copilot" is NOT a real GitHub OAuth scope. Copilot access is
 * determined server-side by whether the account has an active subscription.
 * We map any request for ["copilot"] scope to our standard scope set.
 */
const DEFAULT_SCOPES = ['read:user', 'repo'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeviceCodeResponse {
	device_code: string;
	user_code: string;
	verification_uri: string;
	expires_in: number;   // seconds
	interval: number;     // polling interval in seconds
}

interface TokenResponse {
	access_token?: string;
	token_type?: string;
	scope?: string;
	error?: string;
	error_description?: string;
}

interface GitHubUser {
	id: number;
	login: string;
	avatar_url: string;
	name: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple promisified HTTPS POST that sends/receives application/x-www-form-urlencoded. */
function githubPost(path: string, body: Record<string, string>): Promise<Record<string, string>> {
	return new Promise((resolve, reject) => {
		const encoded = Object.entries(body)
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
			.join('&');

		const options: https.RequestOptions = {
			hostname: GITHUB_API_HOST,
			path,
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'Accept': 'application/json',
				'Content-Length': Buffer.byteLength(encoded),
				'User-Agent': 'Macide/1.0'
			}
		};

		const req = https.request(options, (res: import('http').IncomingMessage) => {
			let data = '';
			res.on('data', (chunk: string) => (data += chunk));
			res.on('end', () => {
				try {
					resolve(JSON.parse(data));
				} catch {
					reject(new Error(`GitHub returned non-JSON response: ${data}`));
				}
			});
		});

		req.on('error', reject);
		req.write(encoded);
		req.end();
	});
}

/** GET from api.github.com with Bearer auth. */
function githubGet<T>(apiPath: string, token: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const options: https.RequestOptions = {
			hostname: GITHUB_API_HOST_API,
			path: apiPath,
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${token}`,
				'Accept': 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				'User-Agent': 'Macide/1.0'
			}
		};

		const req = https.request(options, (res: import('http').IncomingMessage) => {
			let data = '';
			res.on('data', (chunk: string) => (data += chunk));
			res.on('end', () => {
				if (res.statusCode && res.statusCode >= 400) {
					reject(new Error(`GitHub API ${res.statusCode}: ${data}`));
					return;
				}
				try {
					resolve(JSON.parse(data) as T);
				} catch {
					reject(new Error(`GitHub API returned non-JSON: ${data}`));
				}
			});
		});

		req.on('error', reject);
		req.end();
	});
}

/** Sleep for n milliseconds. */
function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// OAuthFlow class
// ---------------------------------------------------------------------------

export class OAuthFlow {
	private _cancelled = false;

	/**
	 * Reads the GitHub OAuth App Client ID from (in priority order):
	 *   1. `MACIDE_GITHUB_CLIENT_ID` environment variable (set at build time)
	 *   2. `macide.githubClientId` VS Code setting
	 *
	 * Throws if neither is configured, prompting the user to set it up.
	 */
	static resolveClientId(): string {
		// Build-time injection via product.json → process.env
		const fromEnv = process.env['MACIDE_GITHUB_CLIENT_ID'];
		if (fromEnv) return fromEnv;

		const fromSettings = vscode.workspace.getConfiguration('macide').get<string>('githubClientId');
		if (fromSettings) return fromSettings;

		throw new Error(
			'Macide: No GitHub OAuth Client ID configured.\n\n' +
			'1. Register an OAuth App at https://github.com/settings/developers\n' +
			'2. Set "macide.githubClientId" in your VS Code settings (or set the\n' +
			'   MACIDE_GITHUB_CLIENT_ID environment variable before launch).'
		);
	}

	/**
	 * Runs the full Device Flow for `scopes` and returns a fully populated
	 * MacideAccount on success.
	 *
	 * @param requestedScopes  Scopes originally requested by the caller (e.g. ["copilot"]).
	 *                         These are normalised to real GitHub OAuth scopes internally.
	 * @param alias            User-supplied label for the account (e.g. "Work", "Personal").
	 */
	async authorize(requestedScopes: readonly string[], alias?: string): Promise<MacideAccount> {
		this._cancelled = false;

		const clientId = OAuthFlow.resolveClientId();

		// Normalise: map any "copilot" pseudo-scope to real scopes
		const scopes = requestedScopes.some(s => s === 'copilot')
			? DEFAULT_SCOPES
			: [...new Set([...DEFAULT_SCOPES, ...requestedScopes.filter(s => s !== 'copilot')])];

		// -----------------------------------------------------------------------
		// Step 1 — Request device code
		// -----------------------------------------------------------------------
		const deviceResp = (await githubPost('/login/device/code', {
			client_id: clientId,
			scope: scopes.join(' ')
		})) as unknown as DeviceCodeResponse;

		if (!deviceResp.device_code || !deviceResp.user_code) {
			throw new Error(`GitHub device code request failed: ${JSON.stringify(deviceResp)}`);
		}

		const { device_code, user_code, verification_uri, expires_in, interval } = deviceResp;
		const expiresAt = Date.now() + expires_in * 1000;
		let pollInterval = (interval ?? 5) * 1000; // ms

		// -----------------------------------------------------------------------
		// Step 2 — Show user_code and open browser
		// -----------------------------------------------------------------------
		const copyAndOpen = 'Copy Code & Open Browser';
		const justOpen = 'Open Browser';

		vscode.window.showInformationMessage(
			`Macide: Authorize GitHub — enter code  ${user_code}  at ${verification_uri}`,
			copyAndOpen,
			justOpen
		).then((selection: string | undefined) => {
			if (selection === copyAndOpen) {
				vscode.env.clipboard.writeText(user_code);
			}
			if (selection === copyAndOpen || selection === justOpen) {
				vscode.env.openExternal(vscode.Uri.parse(verification_uri));
			}
		});

		// Also show a cancellable progress notification while polling
		return vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Macide: Waiting for GitHub authorization…  (code: ${user_code})`,
				cancellable: true
			},
			async (_progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) => {
				token.onCancellationRequested(() => {
					this._cancelled = true;
				});

				// ---------------------------------------------------------------
				// Step 3 — Poll token endpoint
				// ---------------------------------------------------------------
				while (Date.now() < expiresAt) {
					if (this._cancelled) {
						throw new Error('Authorization cancelled by user.');
					}

					await sleep(pollInterval);

					const tokenResp = (await githubPost('/login/oauth/access_token', {
						client_id: clientId,
						device_code,
						grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
					})) as unknown as TokenResponse;

					if (tokenResp.access_token) {
						// -----------------------------------------------------------
						// Step 4 — Fetch user info
						// -----------------------------------------------------------
						const user = await githubGet<GitHubUser>('/user', tokenResp.access_token);

						// -----------------------------------------------------------
						// Step 5 — Build MacideAccount
						// -----------------------------------------------------------
						const grantedScopes = tokenResp.scope
							? tokenResp.scope.split(',').map(s => s.trim())
							: scopes;

						const account: MacideAccount = {
							id: crypto.randomUUID(),
							alias: alias ?? `Account ${user.login}`,
							githubId: String(user.id),
							githubUsername: user.login,
							avatarUrl: user.avatar_url,
							token: tokenResp.access_token,
							scopes: grantedScopes,
							requestCount: 0,
							requestCountDate: new Date().toISOString().slice(0, 10),
							status: 'healthy',
							addedAt: new Date().toISOString(),
							lastUsedAt: new Date().toISOString()
						};

						return account;
					}

					switch (tokenResp.error) {
						case 'authorization_pending':
							// Normal — user hasn't authorized yet
							break;

						case 'slow_down':
							// GitHub is asking us to back off
							pollInterval += 5000;
							break;

						case 'expired_token':
							throw new Error('GitHub authorization code expired. Please try again.');

						case 'access_denied':
							throw new Error('GitHub authorization was denied by the user.');

						default:
							if (tokenResp.error) {
								throw new Error(
									`GitHub OAuth error: ${tokenResp.error} — ${tokenResp.error_description ?? ''}`
								);
							}
					}
				}

				throw new Error('GitHub authorization timed out. Please try again.');
			}
		);
	}

	/** Cancels an in-progress authorization flow. */
	cancel(): void {
		this._cancelled = true;
	}
}
