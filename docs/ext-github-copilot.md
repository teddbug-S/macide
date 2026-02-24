<!-- order: 16 -->

# GitHub Copilot in Macide

Macide has **first-class, built-in GitHub Copilot support**. Unlike a vanilla VSCodium build, you do not need to configure `product.json` or re-enable disabled features — everything is wired up by the `macide-core` extension that ships with the IDE.

## Table of Contents

- [How it works](#how-it-works)
- [Multi-Account Copilot](#multi-account)
- [Installing the Copilot Extensions](#installing)
- [Troubleshooting](#troubleshooting)

## <a id="how-it-works"></a>How it works

Macide registers itself as the `github` authentication provider. When Copilot (or any GitHub extension) calls `vscode.authentication.getSession('github', ...)`, Macide intercepts that request and returns a token from the currently active account. This means:

- No additional `product.json` changes are needed.
- The `chat.disableAIFeatures` setting is already `false` in the default configuration.
- All Copilot features — inline completions, chat, voice, vision — work out of the box.

## <a id="multi-account"></a>Multi-Account Copilot

The primary reason Macide exists is to manage multiple Copilot accounts:

1. Add accounts via `Macide: Add GitHub Account` (Command Palette).
2. Set your rotation strategy in Settings under `macide.accounts.rotationStrategy`.
3. Macide watches every outbound Copilot request and rotates to the next account when the active one approaches its daily limit.

See [Accounts & Authentication](https://github.com/teddbug-S/macide/blob/main/docs/accounts-authentication.md) for the full guide.

## <a id="installing"></a>Installing the Copilot Extensions

Macide ships with the Copilot extensions pre-extracted so first launch is instant. If for any reason you need to install them manually, search for them in the Extensions view (`Ctrl+Shift+X`):

- `GitHub.copilot` — inline completions
- `GitHub.copilot-chat` — chat panel and slash commands

Both are available on [open-vsx.org](https://open-vsx.org/).

## <a id="troubleshooting"></a>Troubleshooting

**Copilot shows "sign in" even after adding an account**  
Run `Macide: Show Account Status` from the Command Palette to confirm an active account is set. If none is set, run `Macide: Add GitHub Account`.

**Copilot completions stop mid-session**  
Your active account may have hit its rate limit. Macide should auto-rotate, but you can force a check with `Macide: Switch Account` from the Command Palette.

**"GitHub Copilot could not connect to server"**  
Check your network. Macide uses the standard `api.github.com` and `copilot-proxy.githubusercontent.com` endpoints — the same ones VS Code uses.
