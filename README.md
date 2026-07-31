# Kura Toolkit

## 1. Overview

Kura Toolkit is a desktop application that bundles four utilities for audio, video, image and file cleanup into a single app. Each feature is accessible from the dashboard or from the category menus in the title bar.

### Audio: Audio Normalizer

- Analyze the loudness (LUFS) and channel layout of audio files (wav / mp3 / aac / flac)
- Normalize files to a target LUFS while keeping the original format, tags and album art
- Configurable sample rate, bitrate mode (CBR/VBR) and bitrate

### Video: Chapter Cut

- Show the chapter list of a video file
- Cut a chapter range without re-encoding (stream copy). The start position automatically snaps to the nearest preceding keyframe, and chapter information is preserved in the output
- Split a file into multiple parts right before the selected chapters
- Frame-accurate mode: re-encodes while keeping the original codecs and bitrates where possible, cutting exactly at the chapter boundary
- Text subtitles in mkv files are re-timed and carried over correctly

### Image: SVG Converter

- Convert raster images (PNG / JPEG / BMP / GIF / TIFF) into vector SVG files (powered by the VTracer engine)
- Adjustable clustering and curve fitting parameters
- Side-by-side preview of the original image and the conversion result, with SVG export

### Tools: Cleanup

- Search for 11 kinds of junk files such as Windows Zone.Identifier, Thumbs.db, .DS_Store and other macOS metadata files/directories
- Zone.Identifier is detected as an alternate data stream on Windows, and as a regular `filename:Zone.Identifier` file on macOS/Linux where it appears after copying from Windows or extracting an archive
- Search targets can be selected from the home directory, drives/volumes and custom directories (system directories are excluded automatically). Read-only media such as CD/DVD is not listed
- Selected items are moved to the trash (Zone.Identifier streams are deleted directly)

On macOS, Full Disk Access is required to search folders such as Desktop, Documents and Downloads. When it has not been granted, the Cleanup screen shows a notice with a shortcut to System Settings (the app must be restarted after granting it).

### App Settings

- Theme (light / dark / system) and language (Japanese / English)
- Paths to the ffmpeg / ffprobe executables (auto-detected from PATH when not set)
- Settings are stored in `~/.kura_toolkit/settings.json`

### Required External Tools

Audio Normalizer and Chapter Cut require [FFmpeg](https://ffmpeg.org/) (ffmpeg / ffprobe). It is not bundled with the app, so install it separately. The app auto-detects it from PATH as well as from common install locations (such as Homebrew on macOS); if it is still not found, set its path in App Settings. SVG Converter and Cleanup do not require any external tools.

## 2. Supported OS

- Windows 10/11
- macOS 10.15+
- Linux (Debian-based / RHEL-based)

Note: Windows builds are not code-signed. If SmartScreen shows a warning, choose "More info" then "Run anyway".

## 3. Developer Reference

### Requirements

- Node.js 22.x or later
- yarn 4
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/jp-yendo/kura_toolkit.git
cd kura_toolkit

# Install dependencies
yarn install

# Start in development mode
yarn dev
```

DevTools in development:

- DevTools opens automatically in detached mode
- Toggle with F12 or Ctrl+Shift+I (Cmd+Option+I on macOS)

### Build / Distribution

- Windows: `yarn dist:win`
- macOS: `yarn dist:mac`
- Linux: `yarn dist:linux`

In development the app loads `http://localhost:3001`; distribution builds load `dist/renderer/index.html`. Page navigation uses HashRouter in both cases.

### Direct Release to GitHub (for auto-update)

These commands upload the build artifacts and `latest*.yml` (auto-update metadata) directly to the GitHub repository configured under `publish:` in `electron-builder.yml`. Because `releaseType: draft` is set, each command accumulates artifacts into **a single draft release for the same version** on GitHub. Once all platforms are uploaded, press "Publish release" in the GitHub UI to deliver it to users.

- Windows: `yarn release:win`
- macOS: `yarn release:mac`
- Linux: `yarn release:linux`

Before running, set a GitHub Personal Access Token (`public_repo` scope) in the `GH_TOKEN` environment variable.

```bash
export GH_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"
```

When building each platform on separate machines, make sure `package.json`'s `version` matches on all machines, then run the corresponding `release:*` command on each machine.

### macOS Prerequisites: Signing / Notarization Environment Variables

To build with signing and notarization for macOS, set the following environment variables before running `yarn dist:mac`.

```bash
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"
```

### Windows Prerequisites: Developer Mode

To run and test unsigned local builds / distributions on Windows, enable Developer Mode in the OS.

1. Settings -> Privacy & security -> For developers
2. Turn on "Developer Mode"
3. Restart the OS

### Project Structure (excerpt)

```text
src/
├── main/                  # Electron main: IPC / services
│   ├── index.ts           # Startup, window creation, service initialization
│   ├── ipc/               # IPC handlers
│   ├── services/          # Settings, job manager, ffmpeg, feature services
│   └── utils/             # Utilities
├── preload/               # Bridges APIs safely to the renderer (window.kuraToolkit)
├── renderer/              # React + MUI UI (pages/stores/components/i18n)
├── shared/                # Type definitions and constants (defaults / storage paths)
└── public/                # Icons etc.
```

See [Documents/システム仕様.md](Documents/システム仕様.md) for the detailed specification (Japanese).

### Technologies

- **Electron**
- **React (MUI)**
- **TypeScript**
- **Zustand**
- **i18next**
- **Vite**
- **@neplex/vectorizer** (VTracer)

### Creating the Windows Icon

```exec
magick public/icon.png -define icon:auto-resize=256,128,96,64,48,32,24,16 public/icon.ico
```

## 4. License

This project is released under the [MIT License](LICENSE).

FFmpeg is not bundled with the app; it is invoked as an external process installed in the user's environment. Therefore the license of the FFmpeg build itself (GPL/LGPL) does not affect the distribution of this app.
