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
	 */
	onRateLimitDetected(account: MacideAccount): void {
		account.status = 'exhausted';
		this.accountManager.updateAccount(account);

		if (this._strategy === 'manual') {
			this.notifications.error(
				`Account "${account.alias}" is rate limited.`,
				{ label: 'Switch Account', action: () => this.accountManager.openAccountPanel() }
			);
			return;
		}

		const next = this.selectNext();
		if (next) {
			this.accountManager.setActive(next);
			this.notifications.info(`Switched to ${next.alias}`);
		} else {
			this.notifications.error('All accounts exhausted. Please wait or add a new account.');
		}
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
			const currentIndex = available.findIndex(a => a.id === currentId);
			return available[(currentIndex + 1) % available.length];
		}

		if (this._strategy === 'least-used') {
			return [...available].sort((a, b) => a.requestCount - b.requestCount)[0];
		}

		return null;
	}

	/**
	 * Resets exhausted accounts whose reset window has passed (daily reset at midnight).
	 */
	resetDailyCountsIfNeeded(): void {
		const today = new Date().toISOString().split('T')[0];
		const accounts = this.accountManager.getAll();
		let changed = false;

		for (const account of accounts) {
			if (account.requestCountDate !== today) {
				account.requestCount = 0;
				account.requestCountDate = today;
				if (account.status === 'exhausted') {
					account.status = 'idle';
				}
				changed = true;
			}
		}

		if (changed) {
			this.accountManager.saveAll(accounts);
		}
	}
}
