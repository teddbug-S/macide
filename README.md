<div id="macide-logo" align="center">
    <br />
    <img src="./icons/stable/codium_cnl.svg" alt="Macide Logo" width="200"/>
    <h1>Macide</h1>
    <h3>Multi-Account Copilot IDE</h3>
</div>

<div id="badges" align="center">

[![current release](https://img.shields.io/github/release/teddbug-S/macide.svg)](https://github.com/teddbug-S/macide/releases)
[![license](https://img.shields.io/github/license/teddbug-S/macide.svg)](https://github.com/teddbug-S/macide/blob/main/LICENSE)

[![build (linux)](https://img.shields.io/github/actions/workflow/status/teddbug-S/macide/macide-build.yml?branch=main&label=build%28linux%29)](https://github.com/teddbug-S/macide/actions/workflows/macide-build.yml)
[![build (macos)](https://img.shields.io/github/actions/workflow/status/teddbug-S/macide/macide-build.yml?branch=main&label=build%28macOS%29)](https://github.com/teddbug-S/macide/actions/workflows/macide-build.yml)
[![build (windows)](https://img.shields.io/github/actions/workflow/status/teddbug-S/macide/macide-build.yml?branch=main&label=build%28windows%29)](https://github.com/teddbug-S/macide/actions/workflows/macide-build.yml)

</div>

**Macide is a free, open-source IDE built on [VSCodium](https://github.com/VSCodium/vscodium) that brings native multi-account GitHub Copilot management, intelligent account rotation, and a premium Obsidian Flow design language — everything a power Copilot user needs, without the Microsoft telemetry.**

## Table of Contents

- [Features](#features)
- [Download/Install](#download-install)
- [Build](#build)
- [Documentation](#more-info)
- [Supported Platforms](#supported-platforms)

## <a id="features"></a>Features

- **Multi-Account Copilot Management** — add multiple GitHub accounts and let Macide rotate through them automatically when you hit rate limits.
- **Auto-Rotation** — intelligent round-robin or least-used rotation with configurable daily request limits.
- **Git Enhancements** — AI commit message generation, inline blame annotations, history graph, stash manager, and conflict bar.
- **Obsidian Flow Design** — dark glassmorphic UI theme with purple-cyan accent gradient, Geist fonts, and Flow Mode for distraction-free coding.
- **Zero Telemetry** — all Microsoft telemetry is stripped at build time. No tracking, no phoning home.
- **Open VSX Extensions** — uses [open-vsx.org](https://open-vsx.org/) as the default extension registry.
- **Auto-Updates** — checks GitHub Releases on launch and delivers updates in the background.

## <a id="download-install"></a>Download/Install

Download the latest release for your platform:

👉 **[github.com/teddbug-S/macide/releases](https://github.com/teddbug-S/macide/releases)**

| Platform | Formats |
|---|---|
| Linux x64 | `.deb`, `.AppImage`, `.rpm` |
| Linux arm64 | `.deb`, `.AppImage` |
| macOS arm64 | `.dmg`, `.zip` |
| macOS x64 | `.dmg`, `.zip` |
| macOS Universal | `.dmg` |
| Windows x64 | `.exe` (NSIS installer), `.zip` |

### Linux (deb)

```bash
sudo dpkg -i macide_<version>_amd64.deb
macide
```

### Linux (AppImage)

```bash
chmod +x Macide-<version>-x86_64.AppImage
./Macide-<version>-x86_64.AppImage
```

### macOS

Download the `.dmg` (or Universal build), open it, and drag **Macide.app** to your Applications folder.

### Windows

Run the `.exe` NSIS installer. Macide will be added to your PATH and Start Menu automatically.

## <a id="build"></a>Build

Build instructions: [docs/howto-build.md](https://github.com/teddbug-S/macide/blob/main/docs/howto-build.md)

```bash
git clone https://github.com/teddbug-S/macide.git
cd macide
./dev/build.sh
```

## <a id="more-info"></a>Documentation

- [Getting Started](https://github.com/teddbug-S/macide/blob/main/docs/getting-started.md)
- [Accounts & Authentication](https://github.com/teddbug-S/macide/blob/main/docs/accounts-authentication.md)
- [GitHub Copilot](https://github.com/teddbug-S/macide/blob/main/docs/ext-github-copilot.md)
- [Extensions + Marketplace](https://github.com/teddbug-S/macide/blob/main/docs/extensions.md)
- [Telemetry](https://github.com/teddbug-S/macide/blob/main/docs/telemetry.md)
- [Troubleshooting](https://github.com/teddbug-S/macide/blob/main/docs/troubleshooting.md)
- [How to Build](https://github.com/teddbug-S/macide/blob/main/docs/howto-build.md)
- [Migration from VS Code](https://github.com/teddbug-S/macide/blob/main/docs/migration.md)

## <a id="supported-platforms"></a>Supported Platforms

Minimum requirements are set by Electron. See [platform prerequisites](https://www.electronjs.org/docs/latest/development/build-instructions-gn#platform-prerequisites).

- [x] macOS arm64 (`dmg`, `zip`) — 11.0+
- [x] macOS x64 (`dmg`, `zip`) — 10.15+
- [x] macOS Universal (`dmg`)
- [x] GNU/Linux x64 (`deb`, `rpm`, `AppImage`, `tar.gz`)
- [x] GNU/Linux arm64 (`deb`, `AppImage`, `tar.gz`)
- [x] GNU/Linux armhf (`deb`, `tar.gz`)
- [x] Windows 10 / Server 2012 R2 or newer x64 (`.exe`, `.zip`)
- [x] Windows 10 / Server 2012 R2 or newer arm64 (`.zip`)

## <a id="license"></a>License

[MIT](https://github.com/teddbug-S/macide/blob/main/LICENSE)
