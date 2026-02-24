/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Git API Helper — minimal type definitions + `getGitApi()` accessor.
 *
 * The VS Code built-in 'vscode.git' extension exports a versioned API.
 * We only declare the subset we actually use to keep the types lean.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Minimal git extension API types (version 1)
// ---------------------------------------------------------------------------

export interface GitExtension {
	readonly enabled: boolean;
	readonly onDidChangeEnablement: vscode.Event<boolean>;
	getAPI(version: 1): GitAPI;
}

export interface GitAPI {
	readonly repositories: Repository[];
	readonly onDidOpenRepository:  vscode.Event<Repository>;
	readonly onDidCloseRepository: vscode.Event<Repository>;
}

export interface Repository {
	readonly rootUri: vscode.Uri;
	readonly state: RepositoryState;
	readonly inputBox: { value: string };
	diff(cached?: boolean): Promise<string>;
	diffWithHEAD(path?: string): Promise<string>;
	log(options?: LogOptions): Promise<Commit[]>;
	getCommit(ref: string): Promise<Commit>;
	status(): Promise<void>;
	stash(message?: string): Promise<void>;
	popStash(index?: number): Promise<void>;
	applyStash(index?: number): Promise<void>;
	dropStash(index?: number): Promise<void>;
}

export interface RepositoryState {
	readonly HEAD:          Branch | undefined;
	readonly refs:          Ref[];
	readonly remotes:       Remote[];
	readonly submodules:    Submodule[];
	readonly rebaseCommit:  Commit | undefined;
	readonly mergeChanges:  Change[];
	readonly indexChanges:  Change[];
	readonly workingTreeChanges: Change[];
	readonly onDidChange:   vscode.Event<void>;
}

export interface Change {
	readonly uri:           vscode.Uri;
	readonly originalUri:   vscode.Uri;
	readonly renameUri:     vscode.Uri | undefined;
	readonly status:        Status;
}

export const enum Status {
	INDEX_MODIFIED      = 0,
	INDEX_ADDED         = 1,
	INDEX_DELETED       = 2,
	INDEX_RENAMED       = 3,
	INDEX_COPIED        = 4,
	MODIFIED            = 5,
	DELETED             = 6,
	UNTRACKED           = 7,
	IGNORED             = 8,
	INTENT_TO_ADD       = 9,
	ADDED_BY_US         = 10,
	ADDED_BY_THEM       = 11,
	DELETED_BY_US       = 12,
	DELETED_BY_THEM     = 13,
	BOTH_ADDED          = 14,
	BOTH_DELETED        = 15,
	BOTH_MODIFIED       = 16
}

export interface Branch extends Ref {
	readonly upstream?: UpstreamRef;
	readonly ahead?:    number;
	readonly behind?:   number;
}

export interface Ref {
	readonly type:   RefType;
	readonly name?:  string;
	readonly commit?: string;
	readonly remote?: string;
}

export const enum RefType { Head = 0, RemoteHead = 1, Tag = 2 }

export interface UpstreamRef {
	readonly remote: string;
	readonly name:   string;
}

export interface Remote {
	readonly name:        string;
	readonly fetchUrl?:   string;
	readonly pushUrl?:    string;
	readonly isReadOnly:  boolean;
}

export interface Submodule {
	readonly name:    string;
	readonly path:    string;
	readonly url:     string;
}

export interface LogOptions {
	maxEntries?: number;
	path?:       string;
	range?:      string;
}

export interface Commit {
	readonly hash:         string;
	readonly message:      string;
	readonly parents:      string[];
	readonly authorDate?:  Date;
	readonly authorName?:  string;
	readonly authorEmail?: string;
	readonly commitDate?:  Date;
}

// ---------------------------------------------------------------------------
// Accessor
// ---------------------------------------------------------------------------

/**
 * Returns the VS Code built-in git API (version 1), or undefined if the git
 * extension is disabled or not yet activated.
 */
export function getGitApi(): GitAPI | undefined {
	const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
	if (!ext) return undefined;
	if (!ext.isActive) return undefined;
	const gitExt = ext.exports;
	if (!gitExt || !gitExt.enabled) return undefined;
	return gitExt.getAPI(1);
}

/**
 * Returns the repository for the currently active file, or the first open
 * repo, or undefined if no repo is open.
 */
export function getActiveRepo(): Repository | undefined {
	const api = getGitApi();
	if (!api || api.repositories.length === 0) return undefined;

	const activeUri = vscode.window.activeTextEditor?.document.uri;
	if (activeUri) {
		// Find the repo whose root is the longest prefix of the active file
		const sorted = [...api.repositories].sort(
			(a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length
		);
		const match = sorted.find(r => activeUri.fsPath.startsWith(r.rootUri.fsPath));
		if (match) return match;
	}
	return api.repositories[0];
}

/** Formats a Date into a human-readable relative string ("3 days ago"). */
export function relativeTime(date: Date | undefined): string {
	if (!date) return 'unknown';
	const diff = Date.now() - date.getTime();
	const s = Math.floor(diff / 1000);
	if (s < 60)    return `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60)    return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24)    return `${h}h ago`;
	const d = Math.floor(h / 24);
	if (d < 30)    return `${d}d ago`;
	const mo = Math.floor(d / 30);
	if (mo < 12)   return `${mo}mo ago`;
	return `${Math.floor(mo / 12)}y ago`;
}
