# Kura Toolkit

## 1. Overview

Kura Toolkit is a desktop application that brings together audio, video and image tools and file cleanup in one app. Each feature can be opened from the dashboard or from the menus in the title bar.

### Audio: Audio Normalizer

- Make the loudness of audio files (wav / mp3 / aac / flac) even and save them
- The original format, tags and album art are kept
- Choose the sample rate and bitrate of the output

### Audio: Audio Separation

- Split songs and recordings into vocals and accompaniment, instruments (drums, bass, guitar, piano and more), or lead and backing vocals
- Remove reverb, echo and noise
- Compare the results of different methods and models, and choose the one to use
- Separate a result further (for example vocals, then lead and backing vocals, then reverb removal)
- Export as MP3 or FLAC

### Audio: Voice Conversion

- Convert a singing or speaking voice into the voice of a chosen voice model
- For songs, only the vocals are converted and then mixed back with the accompaniment, with adjustable volume balance, reverb and more. Changing the key transposes the accompaniment as well
- Compare the results of different settings, and choose the one to use
- Import and export voice models, and search for models on Hugging Face
- Create a voice model of your own voice from recordings made in the app or from audio files

### Audio: Text to Speech

- Read text aloud in Japanese, English or Chinese
- Read rows at their own start and end times (subtitle files in SRT, WebVTT, ASS, SSA or SBV format can be opened)
- Set pauses, speed, pitch, volume and readings with control tags
- Download, import and export voice models
- Create a voice model of your own voice by recording the presented sentences, or by choosing audio files of them (Windows or Linux with an NVIDIA GPU)

### Voice Feature Downloads

Audio Separation, Voice Conversion and Text to Speech need items (Python, packages and models) that are downloaded from within the app. Open "Downloads" on each screen and choose what to download. The download size is shown beforehand.

### Video: Chapter Cut

- Show the chapters of a video
- Cut out a range of chapters (without re-encoding, or re-encoded to cut exactly at the chapter positions)
- Split a video into several files at the chosen chapters

### Image: SVG Converter

- Convert images (PNG / JPEG / BMP / GIF / TIFF) into vector SVG files
- Adjust the conversion settings and check the result next to the original before saving

### Tools: Cleanup

- Find and remove junk files such as Zone.Identifier, Thumbs.db and .DS_Store
- Choose where to search: the home directory, drives or any folder
- Found items are moved to the trash

On macOS, Full Disk Access is required to search folders such as Desktop, Documents and Downloads. When it has not been granted, the Cleanup screen shows how to grant it.

### App Settings

- Theme (light / dark / system) and language (Japanese / English)
- Search threads (how many threads scan directories)
- Location of ffmpeg / ffprobe (found automatically when not set)
- Storage locations (library, model, cache and work directories) and how long the cache is kept

### Required External Tools

Audio Normalizer, Chapter Cut and the voice features (Audio Separation, Voice Conversion, Text to Speech) require [FFmpeg](https://ffmpeg.org/). It is not included with the app, so install it separately.

- Changing the key in Voice Conversion (except by whole octaves), and timed rows in Text to Speech that are sped up to fit their time (the default), need an FFmpeg build that includes rubberband (such as Gyan.FFmpeg from winget on Windows, the Homebrew `ffmpeg` on macOS, or your distribution's `ffmpeg` on Linux)
- The voice feature downloads need an Internet connection and several GB of free space
- Windows: the [Microsoft Visual C++ Redistributable](https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist) (x64, needed for the voice features)
- Recording voices for model training needs permission to use the microphone (on macOS, allow it in System Settings when asked)
- macOS: the Xcode Command Line Tools (`xcode-select --install`, needed for Audio Separation)
- Linux: a C/C++ compiler (such as `build-essential`, needed for Audio Separation)

## 2. Supported OS

- Windows 10/11
- macOS 12 (Monterey) or later
- Linux (Debian-based / RHEL-based)

Audio Separation, Voice Conversion and Text to Speech are available on Windows 10/11 (x64), macOS 14 or later on Apple Silicon, and Linux (x64). They use the GPU when there is one (NVIDIA on Windows and Linux, Apple Silicon on macOS) and the CPU otherwise.

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
│   ├── services/          # Settings (including the defaults), job manager, ffmpeg, feature services
│   ├── workers/           # worker_threads entry points (directory-scan worker)
│   └── utils/             # Utilities
├── python/                # Python scripts for the voice features (run in the downloaded virtual environments)
├── preload/               # Bridges APIs safely to the renderer (window.kuraToolkit)
├── renderer/              # React + MUI UI (pages/stores/components/i18n)
└── shared/                # Shared by main and renderer: type definitions, IPC channel constants, voice text parsing
public/                    # Icons etc.
third_party/               # Data taken from external sources, one folder per source (sentences for training Text to Speech models)
```

See [Documents/システム仕様.md](Documents/システム仕様.md) for the detailed specification and [Documents/テーブル定義.md](Documents/テーブル定義.md) for the stored data (both Japanese).

### Technologies

- **Electron**
- **React (MUI)**
- **TypeScript**
- **Zustand**
- **i18next**
- **Vite**
- **@neplex/vectorizer** (VTracer)
- **Python 3.11** (python-build-standalone), downloaded on demand for the voice features
- **PyTorch**, **audio-separator**, **Applio**, **Style-Bert-VITS2** (sync-dev-org fork), **pedalboard**

### Creating the Windows Icon

```exec
magick public/icon.png -define icon:auto-resize=256,128,96,64,48,32,24,16 public/icon.ico
```

## 4. License

Copyright (C) 2026 jp-yendo

This project is released under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

FFmpeg is not bundled with the app; it is invoked as an external process installed in the user's environment. Therefore the license of the FFmpeg build itself (GPL/LGPL) does not affect the distribution of this app.

### Third-Party Components

The voice features use the following components. Except for the training sentences, they are not bundled with the app: they are downloaded from their sources only when the user starts the download, and the versions are pinned by the app, except for the UVR model configuration files and the NLTK data, which their sources publish only on a branch and which are therefore downloaded from branch URLs. The voice feature downloads also show the license and source of each item.

| Component                                                            | Used for                                     | License                                                                                                    | Source                                                            |
| -------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| python-build-standalone (CPython 3.11)                               | Python runtime                               | PSF-2.0 and the licenses of the bundled libraries                                                          | https://github.com/astral-sh/python-build-standalone              |
| PyTorch                                                              | Inference and training                       | BSD-3-Clause                                                                                               | https://pytorch.org                                               |
| audio-separator                                                      | Audio Separation                             | MIT                                                                                                        | https://github.com/nomadkaraoke/python-audio-separator            |
| Ultimate Vocal Remover (UVR) models                                  | Audio Separation                             | Models by their authors; credit to UVR (Anjok07 and contributors)                                          | https://github.com/Anjok07/ultimatevocalremovergui                |
| Applio                                                               | Voice Conversion and its training            | MIT                                                                                                        | https://github.com/IAHispano/Applio                               |
| RMVPE / FCPE / ContentVec and other embedders, RVC pretrained models | Voice Conversion and its training            | MIT (as distributed by Applio)                                                                             | https://huggingface.co/IAHispano/Applio                           |
| pedalboard                                                           | Mixing (reverb, limiter)                     | GPL-3.0                                                                                                    | https://github.com/spotify/pedalboard                             |
| faiss                                                                | Voice Conversion (index)                     | MIT                                                                                                        | https://github.com/facebookresearch/faiss                         |
| Style-Bert-VITS2 (sync-dev-org fork, style-bert-vits2-mk)            | Text to Speech and its training              | AGPL-3.0 (user dictionary: LGPL-3.0)                                                                       | https://github.com/sync-dev-org/Style-Bert-VITS2                  |
| deberta-v2-large-japanese-char-wwm                                   | Text to Speech (Japanese BERT)               | CC BY-SA 4.0                                                                                               | https://huggingface.co/ku-nlp/deberta-v2-large-japanese-char-wwm  |
| deberta-v3-large                                                     | Text to Speech (English BERT)                | MIT                                                                                                        | https://huggingface.co/microsoft/deberta-v3-large                 |
| chinese-roberta-wwm-ext-large                                        | Text to Speech (Chinese BERT)                | Apache-2.0                                                                                                 | https://huggingface.co/hfl/chinese-roberta-wwm-ext-large          |
| NLTK data: CMUdict, averaged_perceptron_tagger                       | Text to Speech (English pronunciation)       | CMUdict: free use (Carnegie Mellon University) / tagger: MIT                                               | https://github.com/nltk/nltk_data                                 |
| Style-Bert-VITS2 JP-Extra base model                                 | Text to Speech training                      | AGPL-3.0                                                                                                   | https://huggingface.co/litagin/Style-Bert-VITS2-2.0-base-JP-Extra |
| Style-Bert-VITS2 base model (Bert-VITS2 2.1 base models)             | Text to Speech training                      | Not stated on the model card; derived from Bert-VITS2 (AGPL-3.0)                                           | https://huggingface.co/litagin/Style-Bert-VITS2-1.0-base          |
| WavLM Base+                                                          | Text to Speech training (JP-Extra)           | CC BY-SA 3.0                                                                                               | https://huggingface.co/microsoft/wavlm-base-plus                  |
| wespeaker-voxceleb-resnet34-LM                                       | Text to Speech training (style vectors)      | CC BY 4.0                                                                                                  | https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM    |
| pyannote.audio                                                       | Text to Speech training                      | MIT                                                                                                        | https://github.com/pyannote/pyannote-audio                        |
| JVNV voice models                                                    | Text to Speech voice models                  | CC BY-SA 4.0 (inherited from the JVNV corpus)                                                              | https://huggingface.co/litagin/style_bert_vits2_jvnv              |
| ITA corpus (bundled)                                                 | Text to Speech training sentences (Japanese) | Public domain                                                                                              | https://github.com/mmorise/ita-corpus                             |
| CMU ARCTIC prompts (bundled, converted to JSON)                      | Text to Speech training sentences (English)  | CMU ARCTIC license, see [third_party/cmu-arctic/LICENSE.txt](third_party/cmu-arctic/LICENSE.txt) | http://www.festvox.org/cmu_arctic/                                |
| Common Voice zh-CN sentences (bundled, 400 selected)                 | Text to Speech training sentences (Chinese)  | CC0 1.0, see [third_party/common-voice-zh/LICENSE.txt](third_party/common-voice-zh/LICENSE.txt) | https://github.com/common-voice/common-voice                      |
