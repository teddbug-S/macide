/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Account Auto-Rotation Logic.
 * Handles rate-limit detection responses and switches to the next available account.
 *--------------------------------------------------------------------------------------------*/

import type { MacideAccount } from './provider';
import type { AccountManager } from '../accounts/manager';
import type { NotificationService } from '../ui/notifications/notificationService';

export type RotationStrategy = 'round-robin' | 'least-used' | 'manual';

export class AccountRotator {
	private _strategy: RotationStrategy = 'round-robin';
	/** Prevents multiple simultaneous rotation calls from stacking. */
	private _rotating = false;

	constructor(
		private readonly accountManager: AccountManager,
		private readonly notifications: NotificationService
	) {}

	get strategy(): RotationStrategy {
		return this._strategy;
	}

	set strategy(value: RotationStrategy) {
		this._strategy = value;
	}

	/**
	 * Called when a 429 or quota exhaustion is detected on a Copilot API domain.
	 * Marks the current account exhausted and switches to the next available one.
	 * Safe to call from a synchronous response listener — all async work is fire-and-forget
	 * with proper error swallowing so it never crashes the interceptor.
	 */
	onRateLimitDetected(account: MacideAccount): void {
		if (this._rotating) return;          // debounce burst of 429s
		this._rotating = true;

		const exhaustedAlias = account.alias;

		account.status = 'exhausted';
		this.accountManager.updateAccount(account).catch(() => { /* silent */ });

		if (this._strategy === 'manual') {
			this._rotating = false;
			this.notifications.error(
				`"${exhaustedAlias}" hit the Copilot rate limit.`,
				{ label: 'Switch Account', action: () => this.accountManager.openAccountPanel() }
			);
			return;
		}

		const next = this.selectNext();
		if (!next) {
			this._rotating = false;
			this.notifications.error(
				'All accounts exhausted. Add a new account or wait for the daily reset.',
				{ label: 'Open Account Panel', action: () => this.accountManager.openAccountPanel() }
			);
			return;
		}

		this.accountManager.setActive(next)
			.then(() => {
				this.notifications.info(
					`Rate limit hit on "${exhaustedAlias}" — switched to "${next.alias}" (@${next.githubUsername}).`
				);
			})
			.catch(() => { /* silent */ })
			.finally(() => {
				this._rotating = false;
			});
	}

	/**
	 * Programmatic rotation used by the "Simulate Rate Limit" debug command and
	 * the Switch Account command when auto-rotation is on.
	 */
	async triggerRotationNow(): Promise<boolean> {
		const current = this.accountManager.getActive();
		if (!current) return false;

		if (this._strategy === 'manual') {
			await this.accountManager.openAccountPanel();
			return false;
		}

		const next = this.selectNext();
		if (!next || next.id === current.id) {
			this.notifications.warning('No other healthy accounts available to rotate to.');
			return false;
		}

		await this.accountManager.setActive(next);
		this.notifications.info(`Switched to "${next.alias}" (@${next.githubUsername}).`);
		return true;
	}

	/**
	 * Called by the tracker when an account crosses the 80% warning threshold.
	 * Shows a toast so the user knows rotation may be imminent.
	 */
	onWarningThreshold(account: MacideAccount): void {
		const limit = this.accountManager.getAll().length;
		const extra = limit > 1
			? '  Auto-rotation will kick in at the limit.'
			: '  Consider adding another account.';
		this.notifications.warning(
			`"${account.alias}" is at 80% of the daily Copilot request limit.${extra}`
		);
	}

	/**
	 * Selects the next account based on the current strategy.
	 * Returns null if no healthy account is available.
	 */
	selectNext(): MacideAccount | null {
		const available = this.accountManager.getAll()
			.filter(a => a.status !== 'exhausted');

		if (available.length === 0) return null;

		if (this._strategy === 'round-robin') {
			const currentId = this.accountManager.getActive()?.id;
			// Exclude the current account so we actually move to the next one
			const others = available.filter(a => a.id !== currentId);
			if (others.length === 0) return null;
			const allAccounts = this.accountManager.getAll();
			const currentIndex = allAccounts.findIndex(a => a.id === currentId);
			// Walk forward from current index, wrapping around
			for (let i = 1; i <= allAccounts.length; i++) {
				const candidate = allAccounts[(currentIndex + i) % allAccounts.length];
				if (candidate.status !== 'exhausted') return candidate;
			}
			return null;
		}

		if (this._strategy === 'least-used') {
			// Exclude self
			const currentId = this.accountManager.getActive()?.id;
			const candidates = available.filter(a => a.id !== currentId);
			if (candidates.length === 0) return null;
			return [...candidates].sort((a, b) => a.requestCount - b.requestCount)[0];
		}

		return null;
	}

	/**
	 * Resets exhausted accounts and daily counts when the calendar date has rolled over.
	 */
	resetDailyCountsIfNeeded(): void {
		const today = new Date().toISOString().split('T')[0];
		const accounts = this.accountManager.getAll();
		let changed = false;

		for (const account of accounts) {
			if (account.requestCountDate !== today) {
				account.requestCount = 0;
				account.requestCountDate = today;
				if (account.status === 'exhausted' || account.status === 'warning') {
					account.status = 'healthy';
				}
				changed = true;
			}
		}

		if (changed) {
			this.accountManager.saveAll(accounts).catch(() => { /* silent */ });
		}
	}
}
