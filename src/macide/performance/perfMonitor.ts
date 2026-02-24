/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Performance Monitor (spec §10 / M9).
 *
 * Tracks activation time, account-switch latency, and command-palette open
 * time against the budgets defined in the spec:
 *
 *   Cold start → editor ready  < 2500 ms
 *   Account switch latency      <  200 ms
 *   Command palette open        <   80 ms
 *   Account panel first frame   <  150 ms
 *
 * Measurements are:
 *   • Automatically collected during normal use (activation, account switch)
 *   • Accessible via `macide.showPerfReport` command (dev/debug use)
 *   • Written to the Macide Output channel in verbose mode
 *
 * Lazy-load pattern:
 *   Use `LazyPanel<T>` to wrap any heavyweight panel class. The underlying
 *   instance is only created on first access (`.instance`), satisfying the
 *   "lazy-load all Macide-specific panels" requirement from spec §10.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Budget table
// ---------------------------------------------------------------------------

interface Budget {
	label:  string;
	budget: number;   // ms
}

const BUDGETS: Record<string, Budget> = {
	coldStart:       { label: 'Cold start → editor ready',  budget: 2500 },
	accountSwitch:   { label: 'Account switch latency',     budget:  200 },
	commandPalette:  { label: 'Command palette open',       budget:   80 },
	accountPanel:    { label: 'Account panel first frame',  budget:  150 },
	gitStatus:       { label: 'Git status refresh',         budget:  500 },
};

// ---------------------------------------------------------------------------
// Measurement entry
// ---------------------------------------------------------------------------

interface Measurement {
	name:       string;
	elapsed:    number;
	timestamp:  number;
	overBudget: boolean;
}

// ---------------------------------------------------------------------------
// PerfMonitor
// ---------------------------------------------------------------------------

export class PerfMonitor implements vscode.Disposable {
	private readonly _channel:       vscode.OutputChannel;
	private readonly _measurements:  Measurement[] = [];
	private readonly _marks:         Map<string, number> = new Map();
	private readonly _disposables:   vscode.Disposable[] = [];

	/** The epoch when the extension's `activate()` was entered (set by caller). */
	private _activateStart: number = Date.now();

	constructor() {
		this._channel = vscode.window.createOutputChannel('Macide Performance', { log: true });
	}

	// ── Mark / measure ────────────────────────────────────────────────────────

	/** Record the start of a measured operation. */
	mark(name: string): void {
		this._marks.set(name, performance.now());
	}

	/** Record the end of a measured operation and compute its elapsed time. */
	measure(name: string, budgetKey?: string): number {
		const start   = this._marks.get(name);
		if (start === undefined) return -1;

		const elapsed = Math.round(performance.now() - start);
		this._marks.delete(name);

		const budget  = budgetKey ? BUDGETS[budgetKey] : undefined;
		const over    = budget ? elapsed > budget.budget : false;

		const entry: Measurement = {
			name, elapsed, timestamp: Date.now(), overBudget: over
		};
		this._measurements.push(entry);
		if (this._measurements.length > 200) this._measurements.shift();

		const tag = over ? '⚠ OVER BUDGET' : '✓';
		const msg = `[${tag}] ${name}: ${elapsed}ms${budget ? ` (budget ${budget.budget}ms)` : ''}`;

		if (over) {
			this._channel.warn(msg);
		} else {
			this._channel.debug(msg);
		}

		return elapsed;
	}

	/** Record a standalone timing (e.g. cold start where we have start+end). */
	record(name: string, elapsed: number, budgetKey?: string): void {
		const budget  = budgetKey ? BUDGETS[budgetKey] : undefined;
		const over    = budget ? elapsed > budget.budget : false;
		this._measurements.push({ name, elapsed, timestamp: Date.now(), overBudget: over });
		if (this._measurements.length > 200) this._measurements.shift();

		const tag = over ? '⚠ OVER BUDGET' : '✓';
		this._channel.appendLine(`[${tag}] ${name}: ${elapsed}ms${budget ? ` (budget ${budget.budget}ms)` : ''}`);
	}

	/** Record the activation start time (called at the very top of activate()). */
	setActivateStart(t: number): void {
		this._activateStart = t;
	}

	/** Record end-of-activation and measure cold start. */
	recordActivationEnd(): void {
		const elapsed = Math.round(performance.now() - this._activateStart);
		this.record('Cold start → editor ready', elapsed, 'coldStart');
	}

	// ── Report ────────────────────────────────────────────────────────────────

	/** Show a summary QuickPick of all recorded measurements. */
	showReport(): void {
		if (!this._measurements.length) {
			vscode.window.showInformationMessage('Macide: No performance measurements recorded yet.');
			return;
		}

		const items = this._measurements
			.slice()
			.reverse()
			.map(m => ({
				label:       `${m.overBudget ? '$(warning) ' : '$(pass) '}${m.name}`,
				description: `${m.elapsed}ms`,
				detail:      m.overBudget
					? `Over budget! Budget was ${this._budgetFor(m.name)}ms`
					: new Date(m.timestamp).toLocaleTimeString()
			}));

		vscode.window.showQuickPick(items, {
			title:       'Macide Performance Report',
			placeHolder: 'Most recent measurements (newest first)'
		}).then(sel => {
			if (sel?.label.includes('$(warning)')) {
				this._channel.show(true);
			}
		});
	}

	private _budgetFor(name: string): number {
		for (const b of Object.values(BUDGETS)) {
			if (name.startsWith(b.label.split(' ')[0])) return b.budget;
		}
		return -1;
	}

	dispose(): void {
		this._channel.dispose();
		this._disposables.forEach(d => d.dispose());
	}
}

// ---------------------------------------------------------------------------
// LazyPanel<T> — wraps a panel constructor for deferred instantiation
// ---------------------------------------------------------------------------

type Constructor<T> = new (...args: unknown[]) => T;

/**
 * Wraps a panel constructor so the underlying object is only created
 * on first access of `.instance`. Pass extra constructor arguments
 * as a thunk to defer their evaluation too.
 *
 * Usage:
 *   const historyPanel = new LazyPanel(() => new GitHistoryPanel());
 *   // Nothing is created yet.
 *   historyPanel.instance.open();  // ← constructed on first use
 */
export class LazyPanel<T extends vscode.Disposable> implements vscode.Disposable {
	private _instance: T | undefined;

	constructor(private readonly _factory: () => T) {}

	get instance(): T {
		if (!this._instance) {
			this._instance = this._factory();
		}
		return this._instance;
	}

	get isCreated(): boolean { return this._instance !== undefined; }

	dispose(): void {
		this._instance?.dispose();
		this._instance = undefined;
	}
}
