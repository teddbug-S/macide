/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Per-Account Usage Tracker — client-side daily request counting.
 *--------------------------------------------------------------------------------------------*/

import type { MacideAccount } from '../auth/provider';
import type { AccountManager } from './manager';
import type { AccountRotator } from '../auth/rotator';

/** Assumed daily limit (configurable in settings, default 300). */
const DEFAULT_DAILY_LIMIT = 300;
const WARNING_THRESHOLD = 0.8; // 80% → switch status to 'warning'

export class AccountTracker {
	private _dailyLimit: number = DEFAULT_DAILY_LIMIT;

	constructor(
		private readonly accountManager: AccountManager,
		private readonly rotator: AccountRotator
	) {}

	set dailyLimit(limit: number) {
		this._dailyLimit = limit;
	}

	/** Called when a Copilot request succeeds (completion accepted, chat message sent, edit applied). */
	async increment(account: MacideAccount): Promise<void> {
		const today = new Date().toISOString().split('T')[0];

		// Reset if this is a new day
		if (account.requestCountDate !== today) {
			account.requestCount = 0;
			account.requestCountDate = today;
			if (account.status === 'exhausted') {
				account.status = 'healthy';
			}
		}

		account.requestCount += 1;
		account.lastUsedAt = new Date().toISOString();

		// Update status based on usage percentage
		const pct = account.requestCount / this._dailyLimit;
		if (account.status !== 'exhausted') {
			if (pct >= WARNING_THRESHOLD) {
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

	/** Returns last-7-days usage history for the account (from globalState). */
	getUsageHistory(account: MacideAccount, globalState: { get<T>(key: string): T | undefined }): number[] {
		const key = `macide.usage.${account.id}`;
		return globalState.get<number[]>(key) ?? new Array(7).fill(0);
	}
}
