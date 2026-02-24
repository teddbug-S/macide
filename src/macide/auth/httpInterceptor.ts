/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * HTTP Interceptor for Copilot rate-limit detection.
 * Patches Node's https.request at the process level to watch Copilot API domains.
 * On 429: triggers account rotation. On success: increments usage counter.
 *--------------------------------------------------------------------------------------------*/

import * as https from 'https';
import type { MacideAccount } from '../auth/provider';
import type { AccountManager } from '../accounts/manager';
import type { AccountTracker } from '../accounts/tracker';
import type { AccountRotator } from './rotator';

const COPILOT_DOMAINS = [
	'copilot-proxy.githubusercontent.com',
	'api.github.com',
	'githubcopilot.com'
];

function isCopilotDomain(hostname: string): boolean {
	return COPILOT_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`));
}

let _interceptInstalled = false;
const _originalRequest = https.request.bind(https);

export function installHttpInterceptor(
	accountManager: AccountManager,
	tracker: AccountTracker,
	rotator: AccountRotator
): void {
	if (_interceptInstalled) return;
	_interceptInstalled = true;

	// @ts-expect-error — patching https.request
	https.request = function macideInterceptedRequest(
		urlOrOptions: string | URL | https.RequestOptions,
		optionsOrCallback?: https.RequestOptions | ((res: any) => void),
		callback?: (res: any) => void
	): ReturnType<typeof https.request> {
		const options: https.RequestOptions = typeof urlOrOptions === 'string' || urlOrOptions instanceof URL
			? (optionsOrCallback as https.RequestOptions ?? {})
			: urlOrOptions;

		const hostname = options.hostname ?? options.host ?? '';

		if (!isCopilotDomain(hostname)) {
			// @ts-expect-error
			return _originalRequest(urlOrOptions, optionsOrCallback, callback);
		}

		// @ts-expect-error
		const req: ReturnType<typeof https.request> = _originalRequest(urlOrOptions, optionsOrCallback, callback);

		req.on('response', (res: any) => {
			const account = accountManager.getActive();
			if (!account) return;

			if (res.statusCode === 429) {
				rotator.onRateLimitDetected(account);
			} else if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
				tracker.increment(account).catch(() => { /* silent */ });
			}
		});

		return req;
	};
}

export function uninstallHttpInterceptor(): void {
	if (!_interceptInstalled) return;
	// @ts-expect-error
	https.request = _originalRequest;
	_interceptInstalled = false;
}
