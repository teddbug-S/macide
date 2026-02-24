/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * AI-Assisted Commit Message Generator (spec §7.7).
 *
 * Reads the staged diff → sends it to GitHub Copilot via VS Code LM API →
 * streams a Conventional Commits 1.0.0 message into the SCM input box.
 *
 * The user can then accept, edit, or click the button again to regenerate.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getActiveRepo } from './gitApi';

const SYSTEM_PROMPT = `You are a helpful commit message assistant. Given a git diff of staged changes, \
write a concise, descriptive commit message following the Conventional Commits 1.0.0 specification.

Rules:
- Format: <type>(<optional scope>): <description>
- Types: feat, fix, chore, refactor, docs, style, test, perf, ci, build, revert
- First line ≤ 72 characters. No period at the end.
- If the change warrants it, add a blank line followed by a short body (≤ 3 lines).
- Output ONLY the commit message, nothing else — no explanation, no markdown fences.`;

/**
 * Generates an AI commit message for the active repository's staged diff
 * and streams it into the Source Control input box.
 *
 * @returns true if a message was written, false if aborted / unavailable.
 */
export async function generateCommitMessage(context: vscode.ExtensionContext): Promise<boolean> {
	const repo = getActiveRepo();
	if (!repo) {
		vscode.window.showErrorMessage('Macide: No git repository detected in the workspace.');
		return false;
	}

	// Get staged diff
	let diff: string;
	try {
		diff = await repo.diff(true /* cached = staged */);
	} catch {
		vscode.window.showErrorMessage('Macide: Failed to read staged changes. Make sure files are staged before generating a commit message.');
		return false;
	}

	if (!diff.trim()) {
		vscode.window.showInformationMessage('Macide: No staged changes found. Stage your files first, then regenerate.');
		return false;
	}

	// Truncate very large diffs to stay within token limits (approx 8k chars)
	const MAX_DIFF = 8000;
	const truncated = diff.length > MAX_DIFF
		? diff.slice(0, MAX_DIFF) + '\n\n[diff truncated for brevity]'
		: diff;

	// Select a Copilot model
	let models: vscode.LanguageModelChat[];
	try {
		models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
		if (!models.length) {
			models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
		}
	} catch {
		vscode.window.showErrorMessage(
			'Macide: GitHub Copilot is not available. Make sure the Copilot extension is installed and you are signed in.'
		);
		return false;
	}

	if (!models.length) {
		vscode.window.showErrorMessage(
			'Macide: No Copilot language model available. Make sure GitHub Copilot is active.'
		);
		return false;
	}

	const model = models[0];
	const messages = [
		vscode.LanguageModelChatMessage.User(
			`${SYSTEM_PROMPT}\n\nStaged diff:\n\`\`\`\n${truncated}\n\`\`\``
		)
	];

	return vscode.window.withProgress(
		{
			location:    vscode.ProgressLocation.SourceControl,
			title:       'Generating commit message…',
			cancellable: true
		},
		async (_progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) => {
			try {
				const response = await model.sendRequest(messages, {}, token);

				let message = '';
				for await (const fragment of response.text) {
					if (token.isCancellationRequested) break;
					message += fragment;
					// Stream into the input box in real time
					repo.inputBox.value = message.trim();
				}
				return message.trim().length > 0;
			} catch (err: unknown) {
				if ((err as vscode.LanguageModelError)?.code === 'Cancelled') {
					return false;
				}
				vscode.window.showErrorMessage(
					`Macide: Failed to generate commit message — ${err instanceof Error ? err.message : String(err)}`
				);
				return false;
			}
		}
	);
}
