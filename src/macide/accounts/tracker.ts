/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Per-Account Usage Tracker — client-side daily request counting.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { MacideAccount } from '../auth/provider';
import type { AccountManager } from './manager';
import type { AccountRotator } from '../auth/rotator';

const WARNING_THRESHOLD = 0.8; // 80% → switch status to 'warning'
const HISTORY_DAYS = 7;

export class AccountTracker {
	private _dailyLimit: number = 300;
	/** Accounts that already received a warning-threshold toast today, keyed by id+date. */
	private readonly _warnedToday = new Set<string>();

	constructor(
		private readonly accountManager: AccountManager,
		private readonly rotator: AccountRotator,
		private readonly context?: vscode.ExtensionContext
	) {}

	set dailyLimit(limit: number) {
		this._dailyLimit = Math.max(1, limit);
	}

	get dailyLimit(): number {
		return this._dailyLimit;
	}

	/** Called when a Copilot request succeeds (completion accepted, chat message sent, edit applied). */
	async increment(account: MacideAccount): Promise<void> {
		const today = new Date().toISOString().split('T')[0];

		// Reset if this is a new day
		if (account.requestCountDate !== today) {
			// Save yesterday's count to history before resetting
			this._saveHistory(account);

			account.requestCount = 0;
			account.requestCountDate = today;
			if (account.status === 'exhausted' || account.status === 'warning') {
				account.status = 'healthy';
			}
			// Clear warning-sent flag for the new day
			this._warnedToday.delete(account.id);
		}

		account.requestCount += 1;
		account.lastUsedAt = new Date().toISOString();

		// Update status based on usage percentage
		const pct = account.requestCount / this._dailyLimit;
		if (account.status !== 'exhausted') {
			if (pct >= WARNING_THRESHOLD) {
				// Fire the threshold callback exactly once per day per account
				if (!this._warnedToday.has(account.id) && account.status !== 'warning') {
					this._warnedToday.add(account.id);
					this.rotator.onWarningThreshold(account);
				}
				account.status = 'warning';
			} else {
				account.status = 'healthy';
			}
		}

		await this.accountManager.updateAccount(account);
	}

	/**
	 * Returns estimated usage percentage (0–1) for the given account today.
	 */
	getUsagePercent(account: MacideAccount): number {
		const today = new Date().toISOString().split('T')[0];
		if (account.requestCountDate !== today) return 0;
		return Math.min(account.requestCount / this._dailyLimit, 1);
	}

	/**
	 * Returns last-7-days usage history (request counts) for the given account.
	 * Day 0 is today, day 6 is 7 days ago.
	 */
	getUsageHistory(account: MacideAccount): number[] {
		if (!this.context) return new Array(HISTORY_DAYS).fill(0);
		const key = `macide.usage.${account.id}`;
		const stored = this.context.globalState.get<number[]>(key);
		const history = stored ?? new Array(HISTORY_DAYS).fill(0);
		// Prepend today's live count
		history[0] = account.requestCount;
		return history.slice(0, HISTORY_DAYS);
	}

	/**
	 * Resets request count for an account to 0 (for debug / test commands).
	 */
	async resetAccount(account: MacideAccount): Promise<void> {
		account.requestCount = 0;
		account.requestCountDate = new Date().toISOString().split('T')[0];
		if (account.status === 'warning' || account.status === 'exhausted') {
			account.status = 'healthy';
		}
		this._warnedToday.delete(account.id);
		await this.accountManager.updateAccount(account);
	}

	private _saveHistory(account: MacideAccount): void {
		if (!this.context) return;
		const key = `macide.usage.${account.id}`;
		const existing = this.context.globalState.get<number[]>(key) ?? new Array(HISTORY_DAYS).fill(0);
		// Shift: index 0 = today's count (about to be yesterday), push to front
		const updated = [account.requestCount, ...existing].slice(0, HISTORY_DAYS);
		this.context.globalState.update(key, updated).then(undefined, () => { /* silent */ });
	}
}
