/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Git HTTPS Credential Bridge.
 * Intercepts Git credential requests and resolves them from the token vault,
 * automatically routing pushes/pulls/fetches through the correct GitHub account.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { AccountManager } from '../accounts/manager';
import type { NotificationService } from '../ui/notifications/notificationService';

const GITHUB_HTTPS_RE = /^https?:\/\/(?:[^@]+@)?github\.com\//;

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

		// Check if active account can access this remote
		// (For MVP: assume active account owns the remote; cross-account detection in M5)
		return {
			username: active.githubUsername,
			password: `x-access-token:${active.token}`
		};
	}

	/**
	 * Checks if the remote URL belongs to a different stored account than the active one.
	 * If so, prompts the user to switch. Returns true if a switch was performed.
	 * TODO M5: implement owner/org detection via GitHub API.
	 */
	async checkCrossAccountRemote(remoteUrl: string): Promise<boolean> {
		// Cross-account detection requires GitHub API calls — implemented in Milestone 5.
		// For now this is a no-op placeholder.
		return false;
	}

	dispose(): void {
		this._disposables.forEach(d => d.dispose());
	}
}
