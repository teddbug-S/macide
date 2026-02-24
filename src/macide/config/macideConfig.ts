/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Macide Config — ~/.macide/macide-config.json for non-sensitive settings (spec §9.2).
 *
 * Wraps VS Code's workspace/global configuration with a local JSON file at
 * `~/.macide/macide-config.json`. On first launch the file is populated from
 * any existing VS Code configuration entries. Subsequent writes keep both in
 * sync so native VS Code settings panels also reflect Macide values.
 *
 * Only non-sensitive data lives here (no tokens — those stay in OS keychain
 * via vscode.SecretStorage and the vault module).
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const CONFIG_DIR  = path.join(os.homedir(), '.macide');
const CONFIG_FILE = path.join(CONFIG_DIR, 'macide-config.json');

export interface MacideConfigShape {
	accounts: {
		rotationStrategy: 'round-robin' | 'least-used' | 'manual';
		autoRotation:     boolean;
		assumedDailyLimit: number;
	};
	appearance: {
		animationSpeed:            'normal' | 'fast' | 'off';
		glassmorphismIntensity:    number;
		accentColor:               string;
		editorFontFamily:          string;
		editorFontSize:            number;
		vignetteIntensity:         number;
	};
	git: {
		inlineBlame:                'current-line' | 'all-lines' | 'off';
		aiCommitMessages:           boolean;
		credentialBridge:           boolean;
		credentialMismatchBehavior: 'warn' | 'auto-switch' | 'ignore';
		commitFormat:               'conventional' | 'freeform';
	};
	githubClientId: string;
}

const DEFAULTS: MacideConfigShape = {
	accounts: {
		rotationStrategy:  'round-robin',
		autoRotation:      true,
		assumedDailyLimit: 300
	},
	appearance: {
		animationSpeed:         'normal',
		glassmorphismIntensity: 100,
		accentColor:            '#7c3aed',
		editorFontFamily:       'Geist Mono',
		editorFontSize:         13,
		vignetteIntensity:      30
	},
	git: {
		inlineBlame:                'current-line',
		aiCommitMessages:           true,
		credentialBridge:           true,
		credentialMismatchBehavior: 'warn',
		commitFormat:               'conventional'
	},
	githubClientId: ''
};

export class MacideConfig {
	private _data: MacideConfigShape;

	constructor() {
		this._data = this._load();
	}

	// ── Public read access ────────────────────────────────────────────────────

	get<K extends keyof MacideConfigShape>(section: K): MacideConfigShape[K] {
		return this._data[section];
	}

	getAll(): MacideConfigShape {
		return structuredClone(this._data);
	}

	// ── Write ─────────────────────────────────────────────────────────────────

	async set<K extends keyof MacideConfigShape>(
		section: K,
		value: MacideConfigShape[K]
	): Promise<void> {
		this._data[section] = value;
		this._persist();
		// Mirror to VS Code configuration so normal settings panel shows the values
		await this._syncToVsCode(section, value);
	}

	async setNested<K extends keyof MacideConfigShape, F extends keyof MacideConfigShape[K]>(
		section: K,
		field: F,
		value: MacideConfigShape[K][F]
	): Promise<void> {
		(this._data[section] as Record<string,unknown>)[field as string] = value;
		this._persist();
		const key = `macide.${section.toString()}.${field.toString()}`;
		try {
			await vscode.workspace.getConfiguration().update(
				key, value, vscode.ConfigurationTarget.Global
			);
		} catch { /* settings key might not be registered */ }
	}

	// ── Sync from VS Code config (call after vscode.workspace.onDidChangeConfiguration) ──

	syncFromVsCode(): void {
		const cfg = vscode.workspace.getConfiguration('macide');

		this._data.accounts.rotationStrategy  = cfg.get('accounts.rotationStrategy', DEFAULTS.accounts.rotationStrategy) as any;
		this._data.accounts.autoRotation      = cfg.get('accounts.autoRotation',      DEFAULTS.accounts.autoRotation);
		this._data.accounts.assumedDailyLimit = cfg.get('accounts.assumedDailyLimit', DEFAULTS.accounts.assumedDailyLimit);

		this._data.appearance.animationSpeed          = cfg.get('appearance.animationSpeed',          DEFAULTS.appearance.animationSpeed) as any;
		this._data.appearance.glassmorphismIntensity  = cfg.get('appearance.glassmorphismIntensity',  DEFAULTS.appearance.glassmorphismIntensity);
		this._data.appearance.accentColor             = cfg.get('appearance.accentColor',             DEFAULTS.appearance.accentColor);
		this._data.appearance.editorFontFamily        = cfg.get('appearance.editorFontFamily',        DEFAULTS.appearance.editorFontFamily);
		this._data.appearance.editorFontSize          = cfg.get('appearance.editorFontSize',          DEFAULTS.appearance.editorFontSize);
		this._data.appearance.vignetteIntensity       = cfg.get('appearance.vignetteIntensity',       DEFAULTS.appearance.vignetteIntensity);

		this._data.git.inlineBlame                = cfg.get('git.inlineBlame',                DEFAULTS.git.inlineBlame) as any;
		this._data.git.aiCommitMessages           = cfg.get('git.aiCommitMessages',           DEFAULTS.git.aiCommitMessages);
		this._data.git.credentialBridge           = cfg.get('git.credentialBridge',           DEFAULTS.git.credentialBridge);
		this._data.git.credentialMismatchBehavior = cfg.get('git.credentialMismatchBehavior', DEFAULTS.git.credentialMismatchBehavior) as any;
		this._data.git.commitFormat               = cfg.get('git.commitFormat',               DEFAULTS.git.commitFormat) as any;

		this._data.githubClientId = cfg.get('githubClientId', DEFAULTS.githubClientId);

		this._persist();
	}

	// ── Internals ─────────────────────────────────────────────────────────────

	private _load(): MacideConfigShape {
		try {
			if (fs.existsSync(CONFIG_FILE)) {
				const raw  = fs.readFileSync(CONFIG_FILE, 'utf-8');
				const disk = JSON.parse(raw) as Partial<MacideConfigShape>;
				return this._merge(DEFAULTS, disk);
			}
		} catch { /* corrupt file — use defaults */ }

		// First launch: mirror from VS Code configuration
		const cfg = vscode.workspace.getConfiguration('macide');
		const data = structuredClone(DEFAULTS);
		data.accounts.rotationStrategy  = cfg.get('accounts.rotationStrategy', DEFAULTS.accounts.rotationStrategy) as any;
		data.accounts.autoRotation      = cfg.get('accounts.autoRotation',      DEFAULTS.accounts.autoRotation);
		data.accounts.assumedDailyLimit = cfg.get('accounts.assumedDailyLimit', DEFAULTS.accounts.assumedDailyLimit);
		data.appearance.animationSpeed         = cfg.get('appearance.animationSpeed',         DEFAULTS.appearance.animationSpeed) as any;
		data.appearance.glassmorphismIntensity = cfg.get('appearance.glassmorphismIntensity', DEFAULTS.appearance.glassmorphismIntensity);
		data.git.inlineBlame      = cfg.get('git.inlineBlame',      DEFAULTS.git.inlineBlame) as any;
		data.git.aiCommitMessages = cfg.get('git.aiCommitMessages', DEFAULTS.git.aiCommitMessages);
		data.git.credentialBridge = cfg.get('git.credentialBridge', DEFAULTS.git.credentialBridge);
		data.githubClientId       = cfg.get('githubClientId',       DEFAULTS.githubClientId);
		return data;
	}

	private _persist(): void {
		try {
			if (!fs.existsSync(CONFIG_DIR)) { fs.mkdirSync(CONFIG_DIR, { recursive: true }); }
			fs.writeFileSync(CONFIG_FILE, JSON.stringify(this._data, null, 2), 'utf-8');
		} catch { /* ignore write errors in read-only environments */ }
	}

	private async _syncToVsCode<K extends keyof MacideConfigShape>(
		section: K,
		value: MacideConfigShape[K]
	): Promise<void> {
		if (typeof value !== 'object' || value === null) return;
		const cfg = vscode.workspace.getConfiguration(`macide.${section.toString()}`);
		for (const [field, fieldVal] of Object.entries(value as Record<string, unknown>)) {
			try {
				await cfg.update(field, fieldVal, vscode.ConfigurationTarget.Global);
			} catch { /* key not registered — skip */ }
		}
	}

	/** Deep-merge `overrides` onto `base`, ignoring keys not in `base`. */
	private _merge<T extends object>(base: T, overrides: Partial<T>): T {
		const result = structuredClone(base);
		for (const key of Object.keys(base) as (keyof T)[]) {
			const o = overrides[key];
			if (o === undefined) continue;
			if (typeof base[key] === 'object' && base[key] !== null && !Array.isArray(base[key])) {
				(result as any)[key] = this._merge(base[key] as object, (o ?? {}) as object);
			} else {
				(result as any)[key] = o;
			}
		}
		return result;
	}
}
