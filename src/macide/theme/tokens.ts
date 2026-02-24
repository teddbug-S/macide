/*---------------------------------------------------------------------------------------------
 * Macide — Multi-Account Copilot IDE
 * Obsidian Flow Design Token Constants.
 * Single source of truth for all colours, radii, shadows, and motion values
 * used across every TypeScript-generated UI surface.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------

export const COLOR = {
	// ── Backgrounds / Surfaces ──────────────────────────────────────────────
	BG:      '#0a0a0f',
	S1:      '#111118',
	S2:      '#16161f',
	S3:      '#1c1c28',
	S4:      '#222235',

	// ── Glass ───────────────────────────────────────────────────────────────
	GLASS_BG:     'rgba(16, 16, 24, 0.85)',
	GLASS_FILL:   'rgba(255, 255, 255, 0.04)',
	GLASS_BORDER: 'rgba(255, 255, 255, 0.08)',

	// ── Accent ──────────────────────────────────────────────────────────────
	PURPLE: '#7c3aed',
	CYAN:   '#06b6d4',
	GLOW:   'rgba(124, 58, 237, 0.25)',
	GRADIENT: 'linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)',

	// ── Text ────────────────────────────────────────────────────────────────
	TEXT:     '#f0f0f5',
	TEXT_SUB: '#8888a0',
	TEXT_MUTED: '#4a4a60',
	TEXT_DISABLED: '#2e2e45',

	// ── Semantic ────────────────────────────────────────────────────────────
	HEALTHY:  '#22c55e',
	WARNING:  '#f59e0b',
	ERROR:    '#ef4444',
	CONFLICT: '#f97316',
	IDLE:     '#4a4a60',

	// ── Git ─────────────────────────────────────────────────────────────────
	GIT_ADDED:     '#22c55e',
	GIT_MODIFIED:  '#f59e0b',
	GIT_DELETED:   '#ef4444',
	GIT_CONFLICT:  '#f97316',
	GIT_UNTRACKED: '#8888a0',

	// ── Syntax ──────────────────────────────────────────────────────────────
	SYN_STRING:   '#86efac',
	SYN_KEYWORD:  '#a78bfa',
	SYN_FUNCTION: '#67e8f9',
	SYN_TYPE:     '#fde68a',
	SYN_COMMENT:  '#4a4a60',
	SYN_NUMBER:   '#fb923c',
	SYN_OPERATOR: '#f0f0f5',
} as const;

// ---------------------------------------------------------------------------
// Spacing (px)
// ---------------------------------------------------------------------------

export const SPACE = {
	XS:  4,
	SM:  8,
	MD:  12,
	LG:  16,
	XL:  24,
	XXL: 32,
} as const;

// ---------------------------------------------------------------------------
// Border radius (px)
// ---------------------------------------------------------------------------

export const RADIUS = {
	SM:   6,    // menu items
	MD:   8,    // chips, pills, small cards
	LG:   12,   // large floating panels
	PILL: 999,  // fully rounded
} as const;

// ---------------------------------------------------------------------------
// Elevation / shadows
// ---------------------------------------------------------------------------

export const SHADOW = {
	L0: 'none',
	L1: '0 1px 0 rgba(0,0,0,0.4)',
	L2: '0 4px 24px rgba(0,0,0,0.5)',
	L3: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)',
	L4: '0 16px 64px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.08), 0 0 80px rgba(124,58,237,0.08)',
} as const;

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

export const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

export const DURATION = {
	MICRO:  80,    // hover states, icon fades
	SHORT:  150,   // panel reveals, dropdown open
	MEDIUM: 220,   // panel slides, modal appear
	LONG:   350,   // page-level, flow mode
} as const;

/** CSS transition shorthand, respecting prefers-reduced-motion at runtime. */
export function transition(props: string, durMs = DURATION.SHORT): string {
	return `${props} ${durMs}ms ${EASE}`;
}

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export const FONT = {
	MONO: "'Geist Mono', 'Cascadia Code', 'Fira Code', monospace",
	SANS: "'Geist Sans', -apple-system, 'Segoe UI', sans-serif",
} as const;

// ---------------------------------------------------------------------------
// Glass surface CSS snippet (use in webview <style>)
// ---------------------------------------------------------------------------

export const GLASS_CSS = `
  background: ${COLOR.GLASS_BG};
  backdrop-filter: blur(12px) saturate(180%);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  border: 1px solid ${COLOR.GLASS_BORDER};
  border-radius: ${RADIUS.LG}px;
  box-shadow: ${SHADOW.L3};
`;

// ---------------------------------------------------------------------------
// Common webview CSS variable block
// ---------------------------------------------------------------------------

export function cssVars(): string {
	return `
:root {
  --bg:           ${COLOR.BG};
  --s1:           ${COLOR.S1};
  --s2:           ${COLOR.S2};
  --s3:           ${COLOR.S3};
  --s4:           ${COLOR.S4};
  --glass:        ${COLOR.GLASS_FILL};
  --border:       ${COLOR.GLASS_BORDER};
  --purple:       ${COLOR.PURPLE};
  --cyan:         ${COLOR.CYAN};
  --glow:         ${COLOR.GLOW};
  --gradient:     ${COLOR.GRADIENT};
  --text:         ${COLOR.TEXT};
  --sub:          ${COLOR.TEXT_SUB};
  --muted:        ${COLOR.TEXT_MUTED};
  --disabled:     ${COLOR.TEXT_DISABLED};
  --healthy:      ${COLOR.HEALTHY};
  --warning:      ${COLOR.WARNING};
  --error:        ${COLOR.ERROR};
  --font-mono:    ${FONT.MONO};
  --font-sans:    ${FONT.SANS};
  --ease:         ${EASE};
  --dur-micro:    ${DURATION.MICRO}ms;
  --dur-short:    ${DURATION.SHORT}ms;
  --dur-medium:   ${DURATION.MEDIUM}ms;
  --dur-long:     ${DURATION.LONG}ms;
  --shadow-l3:    ${SHADOW.L3};
  --shadow-l4:    ${SHADOW.L4};
}
@media (prefers-reduced-motion: reduce) {
  :root {
    --dur-micro: 0ms; --dur-short: 0ms; --dur-medium: 0ms; --dur-long: 0ms;
  }
}`;
}
