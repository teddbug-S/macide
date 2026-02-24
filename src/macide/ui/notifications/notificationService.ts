/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Notification Service — delegates to ToastService (M6) when initialised,
 * falls back to VS Code's native notification API before M6 is wired.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { ToastService } from '../toast/toastService';

export interface ToastAction {
	label: string;
	action: () => void;
}

export class NotificationService {
	/** Injected by extension.ts after ToastService is constructed. */
	toastService: ToastService | undefined;

	info(message: string, action?: ToastAction): void {
		if (this.toastService) {
			this.toastService.info(message, action ? { label: action.label, callback: action.action } : undefined);
			return;
		}
		if (action) {
			vscode.window.showInformationMessage(`Macide: ${message}`, action.label).then(s => {
				if (s === action.label) action.action();
			});
		} else {
			vscode.window.showInformationMessage(`Macide: ${message}`);
		}
	}

	warning(message: string, action?: ToastAction): void {
		if (this.toastService) {
			this.toastService.warning(message, action ? { label: action.label, callback: action.action } : undefined);
			return;
		}
		if (action) {
			vscode.window.showWarningMessage(`Macide: ${message}`, action.label).then(s => {
				if (s === action.label) action.action();
			});
		} else {
			vscode.window.showWarningMessage(`Macide: ${message}`);
		}
	}

	error(message: string, action?: ToastAction): void {
		if (this.toastService) {
			this.toastService.error(message, action ? { label: action.label, callback: action.action } : undefined);
			return;
		}
		if (action) {
			vscode.window.showErrorMessage(`Macide: ${message}`, action.label).then(s => {
				if (s === action.label) action.action();
			});
		} else {
			vscode.window.showErrorMessage(`Macide: ${message}`);
		}
	}
}
