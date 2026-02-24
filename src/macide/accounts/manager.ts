/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Account Manager — CRUD operations and state machine for all accounts.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { MacideAccount } from '../auth/provider';
import { readVault, writeVault, upsertAccount, removeAccount } from '../auth/vault';

/** States for each account (see spec section 6.4). */
export type AccountStatus = 'healthy' | 'warning' | 'exhausted' | 'idle';

export class AccountManager implements vscode.Disposable {
	private _accounts: MacideAccount[] = [];
	private _activeId: string | undefined;

	private readonly _onDidChangeAccounts = new vscode.EventEmitter<MacideAccount[]>();
	readonly onDidChangeAccounts = this._onDidChangeAccounts.event;

	private readonly _onDidChangeActive = new vscode.EventEmitter<MacideAccount | undefined>();
	readonly onDidChangeActive = this._onDidChangeActive.event;

	constructor(private readonly context: vscode.ExtensionContext) {}

	/** Load accounts from vault into memory. Call once on activation. */
	async load(): Promise<void> {
		this._accounts = await readVault(this.context.secrets);
		const storedActiveId = this.context.globalState.get<string>('macide.activeAccountId');
		if (storedActiveId && this._accounts.some(a => a.id === storedActiveId)) {
			this._activeId = storedActiveId;
		} else if (this._accounts.length > 0) {
			this._activeId = this._accounts[0].id;
		}
	}

	getAll(): MacideAccount[] {
		return [...this._accounts];
	}

	getActive(): MacideAccount | undefined {
		return this._accounts.find(a => a.id === this._activeId);
	}

	async setActive(account: MacideAccount): Promise<void> {
		// Mark previous active as idle
		const prev = this.getActive();
		if (prev && prev.id !== account.id) {
			prev.status = 'idle';
			await upsertAccount(this.context.secrets, prev);
		}

		this._activeId = account.id;
		account.lastUsedAt = new Date().toISOString();
		await upsertAccount(this.context.secrets, account);
		await this.context.globalState.update('macide.activeAccountId', account.id);

		this._onDidChangeActive.fire(account);
		this._onDidChangeAccounts.fire(this.getAll());
	}

	async addAccount(account: MacideAccount): Promise<void> {
		this._accounts = [...this._accounts.filter(a => a.id !== account.id), account];
		await upsertAccount(this.context.secrets, account);
		this._onDidChangeAccounts.fire(this.getAll());
	}

	async removeAccountById(accountId: string): Promise<void> {
		this._accounts = this._accounts.filter(a => a.id !== accountId);
		await removeAccount(this.context.secrets, accountId);
		if (this._activeId === accountId) {
			this._activeId = this._accounts[0]?.id;
			await this.context.globalState.update('macide.activeAccountId', this._activeId);
			this._onDidChangeActive.fire(this.getActive());
		}
		this._onDidChangeAccounts.fire(this.getAll());
	}

	async updateAccount(account: MacideAccount): Promise<void> {
		const idx = this._accounts.findIndex(a => a.id === account.id);
		if (idx >= 0) {
			this._accounts[idx] = account;
		}
		await upsertAccount(this.context.secrets, account);
		this._onDidChangeAccounts.fire(this.getAll());
	}

	async saveAll(accounts: MacideAccount[]): Promise<void> {
		this._accounts = accounts;
		await writeVault(this.context.secrets, accounts);
		this._onDidChangeAccounts.fire(this.getAll());
	}

	/** Opens the account panel webview. Implemented in UI layer (M3). */
	openAccountPanel(): void {
		vscode.commands.executeCommand('macide.openAccountPanel');
	}

	dispose(): void {
		this._onDidChangeAccounts.dispose();
		this._onDidChangeActive.dispose();
	}
}
