<!-- order: 5 -->

# Getting Started with Macide

Macide is a free, open-source IDE that adds native multi-account GitHub Copilot management, intelligent account rotation, and a premium dark design language on top of the MIT-licensed VS Code base.

## Table of Contents

- [Installation](#installation)
- [Adding Your First Account](#first-account)
- [Using Copilot](#using-copilot)
- [Account Rotation](#account-rotation)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Next Steps](#next-steps)

## <a id="installation"></a>Installation

Download the latest build for your platform from the [Releases page](https://github.com/teddbug-S/macide/releases).

| Platform | Recommended format |
|---|---|
| Ubuntu / Debian | `.deb` |
| Fedora / RHEL | `.rpm` |
| Other Linux | `.AppImage` |
| macOS | `.dmg` (Universal for Apple Silicon + Intel) |
| Windows | `.exe` NSIS installer |

After installing, launch **Macide** from your app launcher or run `macide` in a terminal.

## <a id="first-account"></a>Adding Your First Account

On first launch, Macide prompts you to add a GitHub account. You can also do this any time via:

```
Ctrl+Shift+P → Macide: Add GitHub Account
```

This opens the **GitHub Device Flow** — a code appears in the notification, your browser opens, you approve it, and your token is stored securely in the OS keychain. No passwords are ever stored on disk.

Once added, your account appears in the status bar pill at the bottom. Click it to open the **Account Panel**.

## <a id="using-copilot"></a>Using Copilot

Copilot works immediately after adding an account — no additional configuration needed:

- **Inline completions** — type code and accept suggestions with `Tab`.
- **Copilot Chat** — open with `Ctrl+Shift+I` or the chat icon in the sidebar.
- **Inline Chat** — select code and press `Ctrl+I` to ask Copilot about it directly.

Macide intercepts all Copilot authentication requests and routes them through your active account automatically.

## <a id="account-rotation"></a>Account Rotation

Add a second (or third) account and Macide will rotate between them automatically:

1. `Macide: Add GitHub Account` — repeat for each account.
2. Open `Settings → macide.accounts.rotationStrategy` — choose `round-robin` (default), `least-used`, or `manual`.
3. Set `macide.accounts.assumedDailyLimit` to match your Copilot plan's request limit.

When any account approaches its limit, the next one takes over silently — no interruption to your workflow.

## <a id="keyboard-shortcuts"></a>Keyboard Shortcuts

### Macide-specific

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+A` | Open Account Panel |
| `Ctrl+Shift+F` | Toggle Flow Mode (distraction-free) |
| `Ctrl+Shift+G H` | Open Git History Graph |
| `Alt+B` | Toggle blame annotations |

### Standard VS Code shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+P` / `Cmd+P` | Quick Open (Go to File) |
| `Ctrl+Shift+P` / `Cmd+Shift+P` | Command Palette |
| `Ctrl+,` / `Cmd+,` | Settings |
| `Ctrl+I` | Inline Copilot Chat |
| `Ctrl+Shift+I` | Copilot Chat Panel |

## <a id="next-steps"></a>Next Steps

- [Accounts & Authentication](https://github.com/teddbug-S/macide/blob/main/docs/accounts-authentication.md) — deep dive into multi-account management
- [GitHub Copilot](https://github.com/teddbug-S/macide/blob/main/docs/ext-github-copilot.md) — Copilot tips specific to Macide
- [Extensions + Marketplace](https://github.com/teddbug-S/macide/blob/main/docs/extensions.md) — how to install extensions
- [Migration from VS Code](https://github.com/teddbug-S/macide/blob/main/docs/migration.md) — bring your settings and extensions over
