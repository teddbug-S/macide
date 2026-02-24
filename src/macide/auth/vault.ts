/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Token Vault: secure storage of GitHub account tokens via OS native keychain (keytar).
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { MacideAccount } from './provider';

const SERVICE_NAME = 'macide.github.accounts';

/**
 * Reads the JSON array of accounts from the OS keychain.
 * Returns an empty array if nothing is stored yet.
 */
export async function readVault(secrets: vscode.SecretStorage): Promise<MacideAccount[]> {
	const raw = await secrets.get(SERVICE_NAME);
	if (!raw) return [];
	try {
		return JSON.parse(raw) as MacideAccount[];
	} catch {
		return [];
	}
}

/**
 * Writes the full accounts array back to the OS keychain.
 */
export async function writeVault(secrets: vscode.SecretStorage, accounts: MacideAccount[]): Promise<void> {
	await secrets.store(SERVICE_NAME, JSON.stringify(accounts));
}

/**
 * Adds or updates an account in the vault. Matches on account.id.
 */
export async function upsertAccount(secrets: vscode.SecretStorage, account: MacideAccount): Promise<void> {
	const accounts = await readVault(secrets);
	const idx = accounts.findIndex(a => a.id === account.id);
	if (idx >= 0) {
		accounts[idx] = account;
	} else {
		accounts.push(account);
	}
	await writeVault(secrets, accounts);
}

/**
 * Removes an account from the vault by id.
 */
export async function removeAccount(secrets: vscode.SecretStorage, accountId: string): Promise<void> {
	const accounts = await readVault(secrets);
	await writeVault(secrets, accounts.filter(a => a.id !== accountId));
}

/**
 * Clears the entire vault.
 */
export async function clearVault(secrets: vscode.SecretStorage): Promise<void> {
	await secrets.delete(SERVICE_NAME);
}
