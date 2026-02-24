/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Toast Notification Service — lightweight in-editor notifications for Macide events.
 * Full toast UI (glassmorphic pill) is implemented in M6.
 * For M1–M4 this wraps VS Code's built-in notification API.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface ToastAction {
	label: string;
	action: () => void;
}

export class NotificationService {
	info(message: string, action?: ToastAction): void {
		if (action) {
			vscode.window.showInformationMessage(`Macide: ${message}`, action.label).then(selection => {
				if (selection === action.label) action.action();
			});
		} else {
			vscode.window.showInformationMessage(`Macide: ${message}`);
		}
	}

	warning(message: string, action?: ToastAction): void {
		if (action) {
			vscode.window.showWarningMessage(`Macide: ${message}`, action.label).then(selection => {
				if (selection === action.label) action.action();
			});
		} else {
			vscode.window.showWarningMessage(`Macide: ${message}`);
		}
	}

	error(message: string, action?: ToastAction): void {
		if (action) {
			vscode.window.showErrorMessage(`Macide: ${message}`, action.label).then(selection => {
				if (selection === action.label) action.action();
			});
		} else {
			vscode.window.showErrorMessage(`Macide: ${message}`);
		}
	}
}
