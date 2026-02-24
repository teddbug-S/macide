# Macide — Full Product Specification
### Multi-Account Copilot IDE
**Version 1.0 — Build Document**

---

## 1. Project Overview

Macide (Multi-Account Copilot IDE) is a modern, lightweight, beautiful code editor built as a full fork of VSCodium. It solves a real problem for developers running multiple GitHub Copilot subscriptions: the inability to manage, switch between, and auto-rotate across accounts from a single unified interface. Beyond the multi-account system, Macide is a genuinely great IDE — fast, visually stunning, and packed with thoughtful features drawn from the best of Cursor and Antigravity, with a complete, enhanced Git experience baked in.

Macide is not an extension. It is a standalone desktop application distributed for macOS, Windows, and Linux, built on the same Electron + TypeScript foundation as VS Code, with deep modifications to the shell, authentication layer, UI, and feature set.

---

## 2. Core Principles

**Speed first.** The editor should feel faster than stock VS Code on equivalent hardware. Every default that adds overhead without universal value gets removed or made opt-in.

**Beauty without compromise.** The UI is a complete, coherent design system — not a theme applied over VS Code's default chrome. Every surface, panel, and interaction is intentionally designed.

**Multi-account as a first-class citizen.** Account management is not a plugin or an afterthought. It lives in the shell, in the title bar, in the authentication layer, and in the Git credential system.

**Full Git power.** Every VS Code Git capability ships intact and is enhanced with a richer UI and AI-assisted tooling.

**Open and local.** No cloud sync of tokens, no telemetry, no proprietary backend. Everything runs on the user's machine.

---

## 3. Technical Foundation

### 3.1 Base

| Component | Choice | Reason |
|---|---|---|
| Base IDE | VSCodium (latest stable) | MIT licensed, no Microsoft telemetry, full VS Code compatibility |
| Runtime | Electron (inherited) | Same as VS Code, proven for desktop IDE use |
| Primary language | TypeScript | Consistent with VSCodium codebase |
| Extension registry | Open VSX + sideloaded VSIXs | Avoids Microsoft marketplace ToS, Copilot bundled directly |
| Font stack | Geist Mono (editor) + Geist Sans (UI) | Modern, clean, same stack as Cursor/Vercel |
| Token storage | `keytar` (OS native keychain) | Secure, no plaintext on disk |
| Build system | Gulp + esbuild (VSCodium build pipeline) | Consistent with upstream |

### 3.2 Repo Structure

```
macide/
├── src/
│   ├── vs/                          # VSCodium source (forked, minimal patches)
│   └── macide/
│       ├── auth/
│       │   ├── provider.ts          # Custom GitHub AuthenticationProvider
│       │   ├── vault.ts             # Keytar token vault
│       │   ├── rotator.ts           # Auto-rotation logic
│       │   ├── httpInterceptor.ts   # 429 detection via https.request patch
│       │   └── credentialBridge.ts  # Git HTTPS credential resolver
│       ├── accounts/
│       │   ├── manager.ts           # Account CRUD + state machine
│       │   └── tracker.ts           # Per-account usage tracking
│       ├── git/
│       │   ├── enhancedPanel.ts     # Redesigned Source Control panel
│       │   ├── historyGraph.ts      # Floating commit graph
│       │   ├── conflictBar.ts       # Inline conflict action bar
│       │   ├── stashManager.ts      # Stash management UI
│       │   ├── aiCommitMessage.ts   # Copilot-assisted commit messages
│       │   └── blameAnnotation.ts   # Inline blame
│       ├── ui/
│       │   ├── titlebar/            # Custom frameless title bar
│       │   ├── accountPanel/        # Glassmorphic account switcher panel
│       │   ├── branchPill/          # Branch switcher pill
│       │   ├── statusbar/           # Custom status bar
│       │   ├── commandPalette/      # Reskinned command palette
│       │   ├── floatingChat/        # Floating AI chat window
│       │   ├── contextPins/         # Context pins panel
│       │   ├── inlineDiff/          # Enhanced multi-line diff renderer
│       │   ├── notifications/       # Toast notification system
│       │   └── flowMode/            # Focus / Flow Mode
│       ├── theme/
│       │   ├── obsidianFlow.json    # Default color theme
│       │   └── tokens.ts            # Design token constants
│       ├── settings/
│       │   └── webview/             # Custom Macide settings page
│       └── extensions/
│           ├── copilot.vsix         # Bundled GitHub Copilot
│           └── copilot-chat.vsix    # Bundled GitHub Copilot Chat
├── assets/
│   ├── fonts/
│   │   ├── GeistMono/
│   │   └── GeistSans/
│   └── icons/                       # Macide logo, dock icon, file icons
├── build/                           # Build + packaging scripts
├── product.json                     # Fork identity
└── package.json
```

### 3.3 product.json Identity

```json
{
  "nameShort": "Macide",
  "nameLong": "Macide — Multi-Account Copilot IDE",
  "applicationName": "macide",
  "dataFolderName": ".macide",
  "win32MutexName": "macide",
  "licenseName": "MIT",
  "licenseUrl": "https://github.com/macide/macide/blob/main/LICENSE",
  "publisher": "Macide",
  "extensionAllowedProposedApi": [],
  "extensionsGallery": {
    "serviceUrl": "https://open-vsx.org/vscode/gallery",
    "itemUrl": "https://open-vsx.org/vscode/item"
  }
}
```

---

## 4. Design System — "Obsidian Flow"

### 4.1 Philosophy

Obsidian Flow is Macide's complete visual design language. It is not a theme applied over VS Code's default chrome — it is a ground-up redesign of every UI surface. The aesthetic sits at the intersection of Cursor's disciplined minimalism and Antigravity's depth and motion. The editor is always the hero. Every panel, pill, and popup either serves the code or gets out of the way.

Three words describe the feeling: **deep, fluid, alive.**

### 4.2 Color Palette

```
Background base:       #0a0a0f    (near-black, faint blue undertone)
Surface 1:             #111118    (editor background)
Surface 2:             #16161f    (sidebar, panels)
Surface 3:             #1c1c28    (hover states, inputs)
Surface 4:             #222235    (active selections, elevated cards)
Glass fill:            rgba(255, 255, 255, 0.04)
Glass border:          rgba(255, 255, 255, 0.08)
Glass blur:            backdrop-filter: blur(12px) saturate(180%)

Accent gradient:       linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)
Accent purple:         #7c3aed
Accent cyan:           #06b6d4
Accent glow:           rgba(124, 58, 237, 0.25)

Text primary:          #f0f0f5
Text secondary:        #8888a0
Text muted:            #4a4a60
Text disabled:         #2e2e45

Git added:             #22c55e
Git modified:          #f59e0b
Git deleted:           #ef4444
Git conflict:          #f97316
Git untracked:         #8888a0

Status healthy:        #22c55e
Status warning:        #f59e0b
Status exhausted:      #ef4444
Status idle:           #4a4a60

Syntax strings:        #86efac
Syntax keywords:       #a78bfa
Syntax functions:      #67e8f9
Syntax types:          #fde68a
Syntax comments:       #4a4a60
Syntax numbers:        #fb923c
Syntax operators:      #f0f0f5
```

### 4.3 Typography

```
Editor font:           Geist Mono, 'Cascadia Code', 'Fira Code', monospace
UI font:               Geist Sans, -apple-system, 'Segoe UI', sans-serif

Editor font size:      14px (default)
Editor line height:    1.6
UI font size:          13px
UI line height:        1.5

Font weights used:
  Regular:             400  (body text, editor)
  Medium:              500  (labels, UI elements)
  Semibold:            600  (headings, active states)
```

### 4.4 Motion & Animation

All transitions use `cubic-bezier(0.16, 1, 0.3, 1)` (an ease-out-expo curve) unless noted.

```
Micro (hover states, icon fades):          80ms
Short (panel reveals, dropdown open):      150ms
Medium (panel slides, modal appear):       220ms
Long (page-level transitions, flow mode):  350ms

Reduced motion: all durations collapse to 0ms when
prefers-reduced-motion: reduce is detected.
```

### 4.5 Elevation & Shadow System

```
Level 0 (flat, editor surface):    no shadow
Level 1 (status bar, tab bar):     0 1px 0 rgba(0,0,0,0.4)
Level 2 (sidebar, panels):         0 4px 24px rgba(0,0,0,0.5)
Level 3 (floating panels, chat):   0 8px 48px rgba(0,0,0,0.6),
                                   0 0 0 1px rgba(255,255,255,0.06)
Level 4 (modals, command palette): 0 16px 64px rgba(0,0,0,0.8),
                                   0 0 0 1px rgba(255,255,255,0.08),
                                   0 0 80px rgba(124,58,237,0.08)
```

### 4.6 Glassmorphism Rules

Glass surfaces are used for floating elements only — panels that sit above the editor plane.

- Background: `rgba(16, 16, 24, 0.85)` + `backdrop-filter: blur(12px) saturate(180%)`
- Border: `1px solid rgba(255, 255, 255, 0.08)`
- Border radius: `12px` for large panels, `8px` for small chips/pills, `6px` for menu items
- Never use glass for the editor background, sidebar background, or status bar

---

## 5. UI Components

### 5.1 Title Bar

Fully custom, frameless, draggable. Height: 40px. Background: `#0a0a0f` with a `1px` bottom border at `rgba(255,255,255,0.06)`.

**Left zone:** Macide logo mark (20px, gradient M) + workspace name (Geist Sans Medium 13px) + macOS traffic lights (12px left padding).

**Center zone:** Pill-shaped command palette trigger, 320px wide, placeholder "Search commands, files, settings…" + `⌘K` badge.

**Right zone (left to right):** Branch pill → Account switcher pill → Window controls (Windows/Linux).

### 5.2 Account Switcher Pill

- Pill shape, `8px` border radius
- Background: Surface 3 + `1px` accent gradient border-image
- Left: 8px status dot (green/amber/red)
- Center: account alias, Geist Sans Medium 13px
- Right: chevron-down 12px
- Animated gradient border: 4s infinite, pauses on battery saver
- On click: Account Panel slides down (220ms ease-out-expo)
- On auto-rotation: 600ms pulse + alias crossfade

### 5.3 Branch Pill

- Git branch icon (16px) + branch name
- Same pill shape, simpler border (no gradient animation)
- Dirty indicator dot when uncommitted changes exist
- `↑2 ↓1` ahead/behind in muted text
- On click: glassmorphic branch switcher quick-pick

### 5.4 Account Panel

Floating glassmorphic panel, 380px wide, max 80vh. Anchored to title bar right edge.

**Sections:**
- Header: "Accounts" title + "Add Account" button
- Account cards: avatar circle (32px) + alias + username + usage bar + status badge + Switch button
- Usage bar: 4px progress, accent gradient → amber → red
- Footer: "Manage Accounts" → settings page

### 5.5 Status Bar

24px height, `#0a0a0f` background.

- Left: branch icon + name + dirty dot + `↑↓` indicators + error/warning counts
- Right: active account name + language mode + line/col + encoding + EOL

### 5.6 Command Palette

640px wide, centered, glass background, Level 4 shadow. Grouped results: Recent / Git / Accounts / Files. 220ms open animation (scale 0.96→1 + opacity).

### 5.7 Floating AI Chat

Bottom-right, 360×520px, 16px from edges. Glass panel, Level 3 shadow. Draggable by header. Resizable. Collapsed to pill state.

### 5.8 Context Pins Panel

Pin files and code selections as persistent context for every Copilot Chat request. Right-click → "Pin to AI Context". Toggle active/inactive per pin.

### 5.9 Inline Diff View

Multi-line suggestions rendered as visual diffs instead of ghost text.
- Added lines: `rgba(34, 197, 94, 0.08)` bg + `2px #22c55e` left border
- Removed lines: `rgba(239, 68, 68, 0.08)` bg
- Action bar chip: "Accept" / "Reject" / "Accept Line" / "Open in Diff Editor"

### 5.10 Flow Mode

Trigger: `Cmd+.`. Collapses sidebar, status bar, panel. Shrinks title bar. Adds vignette overlay. 350ms ease-out-expo. Exit: Escape or `Cmd+.` again.

### 5.11 Toast Notification System

Bottom-right, glass pill, Level 3 shadow. Types: Info (3s auto-dismiss) / Warning (5s) / Error (no auto-dismiss). Stack up to 3, 8px gap.

---

## 6. Multi-Account System

### 6.1 Architecture

Three layers: AuthenticationProvider (intercepts Copilot auth) → Token Vault (OS keychain) → Rotator (switching logic).

### 6.2 Custom GitHub Authentication Provider

Registers with ID `github` before Copilot activates. `getSessions()` returns the active account's token. `createSession()` triggers OAuth flow.

### 6.3 Token Vault

`vscode.SecretStorage` (wraps OS native keychain). Service name: `macide.github.accounts`. Stores JSON array of `MacideAccount` objects. No plaintext on disk.

```typescript
interface MacideAccount {
  id: string;
  alias: string;
  githubId: string;
  githubUsername: string;
  avatarUrl: string;
  token: string;
  refreshToken?: string;
  scopes: string[];
  requestCount: number;
  requestCountDate: string;
  status: 'healthy' | 'warning' | 'exhausted' | 'idle';
  addedAt: string;
  lastUsedAt: string;
}
```

### 6.4 Account Manager State Machine

```
IDLE → ACTIVE:        user selects account
ACTIVE → WARNING:     request count > 80% of assumed limit
ACTIVE → EXHAUSTED:   429 received
EXHAUSTED → IDLE:     next account becomes active
any → IDLE:           user manually deselects
```

### 6.5 Auto-Rotation Logic

Round-robin (default), least-used, or manual. Triggered by HTTP interceptor detecting 429 on Copilot domains. Daily count reset at midnight.

### 6.6 HTTP Interception

Patches `https.request` at process level. Watches: `copilot-proxy.githubusercontent.com`, `api.github.com`, `githubcopilot.com`. On 429 → rotator. On 2xx → tracker increment.

### 6.7 Rotation Strategies

- **Round Robin (default):** cycles in add order, skips exhausted
- **Least Used First:** routes to lowest daily count
- **Manual Only:** no auto-rotate, shows "Switch Now" action toast

### 6.8 Request Tracking

Client-side daily count per account. Reset at midnight. Tracked: inline completion accepted, chat message sent, edit applied. Assumed limit: 300/day (configurable).

---

## 7. Git Integration

### 7.1 Full VSCode Git Parity

All VS Code Git features ship intact: source control panel, gutter indicators, diff editor, branch management, merge/rebase, pull/push/fetch, tags, submodules, Timeline, multi-root support.

### 7.2 Redesigned Source Control Panel

Obsidian Flow reskin. Three sections: Staged / Changes / Untracked, each collapsible with count badges. Card-like file rows (10px vertical padding). Hover-reveal action buttons. Commit panel below.

### 7.3 Commit Panel

5-line textarea (expands to 10). Character counter (amber at 72, red at 100). Buttons: Commit / Commit & Push / Amend. Overflow: --no-verify, signed, empty commit. Sparkle button → AI commit message.

### 7.4 Floating Git History Graph

`Cmd+Shift+G H`. Glassmorphic floating panel. Visual branch graph with colored lines. Commit rows: hash + message + avatar + timestamp. Click to expand. Right-click context menu: checkout, cherry-pick, revert, create branch, copy hash.

### 7.5 Branch Switcher

Glassmorphic quick-pick. "New Branch" input at top + "Push and set upstream" checkbox. Local Branches + Remote Branches sections. Each row: name + last commit + relative time + ahead/behind.

### 7.6 Inline Conflict Resolution

Glass pill above `<<<<<<` line: "Keep Ours" / "Keep Theirs" / "Keep Both" / "3-Way View". Green left border (ours), blue left border (theirs). On resolve: toast "All conflicts resolved — Stage file?"

### 7.7 AI-Assisted Commit Messages

Sparkle button → read staged diff → send to Copilot Chat API → stream Conventional Commits 1.0.0 message into textarea. User can accept, edit, or "Regenerate".

### 7.8 Inline Git Blame

Current line: `author · relative time · short hash`, appears 500ms after cursor stops. Hover: full commit tooltip. All-lines mode: `Cmd+Shift+G B`. Fixed-width column, 40% opacity.

### 7.9 Stash Manager

Source Control `...` → "Manage Stashes". Cards: stash index + message + files changed + timestamps. Actions: Apply / Pop / Drop / Show Diff. "New Stash" button with optional message.

### 7.10 Git + Multi-Account Credential Bridge

Intercepts Git HTTPS auth on `github.com` remotes. Uses active account's token as `x-access-token:<token>`. If active account lacks access but another does: toast "Use [Account B]?" with one-click switch. Cross-account detection via GitHub API (M5).

### 7.11 Status Bar Git Section

Branch icon + name (clickable) → dirty dot (amber) → `↑` ahead → `↓` behind → spinning sync icon → error count badge (clickable → Git output).

---

## 8. Antigravity-Inspired Features

### 8.1 Inline AI Diff View
See §5.9.

### 8.2 Context Pins
See §5.8.

### 8.3 Floating AI Chat
See §5.7.

### 8.4 Smart Session Memory

On close: save open files + scroll positions, active account, context pins, chat history (last 10), panel layout, Flow Mode state. Restored within 500ms on open.

### 8.5 Flow Mode
See §5.10.

### 8.6 Command Palette Contextual Surfacing

- Cursor in function → "Explain", "Write tests", "Refactor" surfaced
- Merge conflict → "Resolve All", "3-Way Diff" surfaced
- Account near limit → "Switch Account" surfaced
- Uncommitted changes → "Commit with AI Message", "View Diff" surfaced

---

## 9. Settings & Configuration

### 9.1 Macide Settings Page

Custom webview, `Cmd+,`. Four sections:

**Accounts:** list, add/remove/reorder, alias edit, usage history chart, rotation strategy, daily limit, auto-rotation toggle.

**Appearance:** theme selector, glassmorphism intensity slider, animation speed, accent color picker, font pickers, vignette intensity.

**Git:** inline blame toggle, AI commit messages toggle, credential bridge toggle, mismatch behavior, commit format.

**Keybindings:**
- Account switcher: `Cmd+Shift+A`
- Branch switcher: `Cmd+Shift+B`
- Git history: `Cmd+Shift+G H`
- Flow mode: `Cmd+.`
- Floating chat: `Cmd+Shift+C`
- Context pins: `Cmd+Shift+X`
- AI commit: `Cmd+Shift+M`

### 9.2 Config Storage

`~/.macide/macide-config.json` for non-sensitive settings. OS keychain for tokens.

---

## 10. Performance Targets

| Metric | Target |
|---|---|
| Cold start to editor ready | < 2.5 seconds |
| Account switch latency | < 200ms |
| Command palette open | < 80ms |
| Account panel open animation | < 150ms (to first frame) |
| RAM baseline (empty workspace) | < 280MB |
| RAM with Copilot active | < 450MB |
| Git status refresh | < 500ms for repos up to 10k files |

### Performance Measures

- Lazy-load all Macide-specific panels
- Copilot VSIXs pre-extracted at install time
- Geist fonts subset to used character ranges at build time
- Telemetry and Microsoft-specific services stripped
- Electron flags: `--disable-background-timer-throttling`, `--disable-renderer-backgrounding`, `--enable-gpu-rasterization`
- Tree-shake unused VS Code built-in extensions at build time

---

## 11. Distribution & Build

### 11.1 Platforms

| Platform | Format | Notes |
|---|---|---|
| macOS (Apple Silicon) | `.dmg` | Notarized, code-signed, native arm64 |
| macOS (Intel) | `.dmg` | Notarized, code-signed, x64 |
| macOS (Universal) | `.dmg` | Fat binary |
| Windows 10/11 | `.exe` (NSIS) | Windows 11 Acrylic blur |
| Windows 10/11 | `.zip` (portable) | |
| Linux | `.deb` | Debian/Ubuntu |
| Linux | `.AppImage` | Universal |
| Linux | `.rpm` | Fedora/RHEL |

### 11.2 Auto-Update

Self-hosted or GitHub Releases. Checks on launch + every 24h. Downloads in background, applies on restart. Status bar indicator "Update ready — restart to apply".

### 11.3 Build Pipeline

VSCodium gulp pipeline as base. Additional tasks: Macide asset compilation, font subsetting, VSIX pre-extraction, theme baking. GitHub Actions CI. Artifacts uploaded on version tag push.

---

## 12. Development Milestones

### Milestone 1 — Foundation ✅ COMPLETE
Fork VSCodium. Update `product.json` with Macide identity. Apply Obsidian Flow as default theme. Bundle Geist fonts. Strip telemetry. Verify build launches on all platforms.

**Done:** Identity rebranded throughout. Obsidian Flow theme created. Linux desktop/appdata metadata updated. `disable-copilot.patch` disabled. `src/macide/` TypeScript scaffold created (auth provider, vault, rotator, HTTP interceptor, credential bridge, account manager, tracker, notification service, extension entry point). Bundled extension manifests in `src/stable/extensions/`.

### Milestone 2 — Auth Core
Implement OAuth flow. Build token vault with `vscode.SecretStorage`. Wire up adding a single GitHub account. Verify Copilot completions work through the stored token.

**Done when:** One account can be added, Copilot ghost text appears in the editor.

### Milestone 3 — Multi-Account Switcher MVP
Build title bar account pill and floating account panel webview. Support adding multiple accounts. Implement manual switching. Verify Copilot routes through whichever account is active.

**Done when:** Three accounts can be added, switching works, Copilot uses the correct token each time.

### Milestone 4 — Auto-Rotation
Implement HTTP interception (scaffold done in M1). Build rotator with round-robin strategy. Toast notifications for switch events. Test by simulating 429 responses.

**Done when:** Simulated rate limit causes automatic account switch and Copilot retries transparently.

### Milestone 5 — Git Enhancements
Redesigned Source Control panel, commit panel with AI commit messages, branch pill in title bar, floating Git history graph, inline conflict action bar, blame annotations, stash manager, credential bridge (cross-account detection via GitHub API).

**Done when:** All Git enhancements work end-to-end, credential bridge resolves HTTPS auth from vault.

### Milestone 6 — UI Polish
Custom frameless title bar, full Obsidian Flow design language applied to all panels, glassmorphism, animation system, Flow Mode, toast system, command palette reskin.

**Done when:** IDE looks and feels like the design spec. Motion is smooth. Glass surfaces render correctly on all three platforms.

### Milestone 7 — Antigravity Features
Inline diff view for multi-line suggestions, Context Pins panel, floating AI chat, smart session memory, contextual command palette surfacing.

**Done when:** All five features work end-to-end and feel integrated.

### Milestone 8 — Settings & Config
Webview settings page with all four sections, all settings wired to their respective systems, keybinding customization.

**Done when:** Every configurable option can be changed from the settings UI and takes effect immediately.

### Milestone 9 — Performance & Distribution
Hit all performance targets. Build pipeline for all platforms. Auto-update system. Code signing and notarization for macOS. Beta release on GitHub Releases.

**Done when:** All performance targets met, installers work on clean machines, auto-update delivers a patch successfully.

---

## 13. Out of Scope for v1.0

- Cloud sync of accounts or settings
- Proprietary AI backend (all AI routes through GitHub Copilot)
- Mobile or web version
- Built-in terminal redesign
- Custom extension marketplace
- Team or organization account management features
- Plugin/extension API for third-party account providers

---

*This document is the single source of truth for Macide v1.0.*
