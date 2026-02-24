<!-- order: 0 -->

# Accounts & Authentication

Macide replaces VS Code's single-account GitHub auth with a full multi-account management system. You can add as many GitHub accounts as you like; Macide automatically rotates between them to keep your Copilot requests flowing without hitting rate limits.

## Table of Contents

- [Adding an Account](#adding-an-account)
- [Switching Accounts](#switching-accounts)
- [Auto-Rotation](#auto-rotation)
- [Rate Limit Handling](#rate-limit-handling)
- [Removing an Account](#removing-an-account)
- [Personal Access Tokens](#personal-access-tokens)
- [Keychain Storage](#keychain-storage)

## <a id="adding-an-account"></a>Adding an Account

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:

```
Macide: Add GitHub Account
```

This starts the **GitHub Device Flow**:

1. A device code is shown in a notification.
2. Your browser opens to `github.com/login/device`.
3. Enter the code — Macide polls in the background and stores the token once you approve.

Alternatively, any Copilot action that requires auth (e.g. opening a chat) will trigger the same flow automatically.

## <a id="switching-accounts"></a>Switching Accounts

Run `Macide: Open Account Panel` or click the account pill in the status bar. The glassmorphic Account Panel lets you:

- See all accounts and their request counts
- Switch the active account (one click)
- Rename accounts with friendly aliases
- Remove accounts

The active account's token is forwarded to every Copilot request automatically via Macide's HTTP interceptor.

## <a id="auto-rotation"></a>Auto-Rotation

Macide monitors request counts and switches to the next account before GitHub can rate-limit you. Configure via Settings (`Ctrl+,`) or `Macide: Open Settings`:

| Setting | Default | Description |
|---|---|---|
| `macide.accounts.rotationStrategy` | `round-robin` | `round-robin`, `least-used`, or `manual` |
| `macide.accounts.assumedDailyLimit` | `300` | Requests per account before rotation triggers |
| `macide.accounts.autoRotate` | `true` | Enable/disable automatic rotation |

## <a id="rate-limit-handling"></a>Rate Limit Handling

When a `429 Too Many Requests` response is received from any Copilot endpoint, Macide:

1. Marks the current account as exhausted.
2. Immediately switches to the next available account.
3. Retries the original request transparently — the extension that made the request never sees an error.
4. Shows a brief status bar notification: `Switched to @username`.

Daily counts reset at midnight UTC.

## <a id="removing-an-account"></a>Removing an Account

Run `Macide: Remove Account` from the Command Palette or use the trash icon in the Account Panel. Macide will ask for confirmation then delete the token from your OS keychain.

## <a id="personal-access-tokens"></a>Personal Access Tokens

If you prefer to use a Personal Access Token (PAT) instead of Device Flow:

1. Create a PAT at [github.com/settings/tokens](https://github.com/settings/tokens) with the `read:user` and `repo` scopes.
2. When prompted for auth, paste the PAT instead of completing the Device Flow.

## <a id="keychain-storage"></a>Keychain Storage

All tokens are stored in your OS keychain:

- **macOS** — Keychain Access
- **Linux** — `libsecret` / GNOME Keyring / KDE Wallet
- **Windows** — Windows Credential Manager

Tokens are never written to disk in plaintext.
