/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Custom GitHub AuthenticationProvider.
 * Registers with ID 'github' before Copilot activates so our provider takes precedence.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { removeAccount } from './vault';
import { AccountManager } from '../accounts/manager';
import { OAuthFlow } from './oauthFlow';

export interface MacideAccount {
	id: string;               // UUID
	alias: string;            // User-defined name e.g. "Account A"
	githubId: string;
	githubUsername: string;
	avatarUrl: string;
	token: string;            // OAuth access token
	refreshToken?: string;
	scopes: string[];
	requestCount: number;     // Client-side daily count
	requestCountDate: string; // ISO date of current count window
	status: 'healthy' | 'warning' | 'exhausted' | 'idle';
	addedAt: string;
	lastUsedAt: string;
}

export class MacideGitHubAuthProvider implements vscode.AuthenticationProvider, vscode.Disposable {
	readonly onDidChangeSessions: vscode.Event<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>;

	private readonly _onDidChangeSessions =
		new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();

	private readonly _sessionChangeEmitter = this._onDidChangeSessions;

	/** The active Device Flow instance, if one is in progress. */
	private _activeFlow: OAuthFlow | undefined;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly accountManager: AccountManager
	) {
		this.onDidChangeSessions = this._onDidChangeSessions.event;
	}

	async getSessions(scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
		const active = this.accountManager.getActive();
		if (!active) return [];
		return [this._buildSession(active)];
	}

	async createSession(scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
		// Cancel any previous in-progress flow
		this._activeFlow?.cancel();

		const flow = new OAuthFlow();
		this._activeFlow = flow;

		try {
			const account = await flow.authorize(scopes);

			// Persist into vault and register with the account manager
			await this.accountManager.addAccount(account);

			// Make the newly added account the active one immediately
			await this.accountManager.setActive(account);

			const session = this._buildSession(account);
			this._sessionChangeEmitter.fire({ added: [session], removed: [], changed: [] });
			return session;
		} finally {
			this._activeFlow = undefined;
		}
	}

	async removeSession(sessionId: string): Promise<void> {
		await removeAccount(this.context.secrets, sessionId);
		this._sessionChangeEmitter.fire({ added: [], removed: [{ id: sessionId, accessToken: '', account: { id: sessionId, label: '' }, scopes: [] }], changed: [] });
	}

	/** Fires when the active account changes so Copilot re-fetches its session. */
	notifySessionChanged(account: MacideAccount): void {
		const session = this._buildSession(account);
		this._sessionChangeEmitter.fire({ added: [session], removed: [], changed: [] });
	}

	private _buildSession(account: MacideAccount): vscode.AuthenticationSession {
		return {
			id: account.id,
			accessToken: account.token,
			account: { id: account.githubId, label: account.alias },
			scopes: account.scopes
		};
	}

	dispose(): void {
		this._activeFlow?.cancel();
		this._onDidChangeSessions.dispose();
	}
}
