# Kura Toolkit

## 1. Overview

Kura Toolkit is a desktop application that bundles utilities for audio, voice, video, image and file cleanup into a single app. Each feature is accessible from the dashboard or from the category menus in the title bar.

### Audio: Audio Normalizer

- Analyze the loudness (LUFS) and channel layout of audio files (wav / mp3 / aac / flac)
- Normalize files to a target LUFS while keeping the original format, tags and album art
- Configurable sample rate, bitrate mode (CBR/VBR) and bitrate

### Audio: Audio Separation

- Split songs and recordings into vocals and accompaniment, instruments (drums, bass, guitar, piano and more), or lead and backing vocals, and remove reverb, echo and noise (powered by audio-separator and the Ultimate Vocal Remover models)
- Choose a model from the list provided by audio-separator, a verified ensemble combination, your own combination of models, or the classic center-channel cancellation for comparison
- Every result is listed as a candidate. Compare the candidates with synchronized playback (switching keeps the playback position) and adopt the one you like
- Separate the adopted results further, stage by stage (for example vocals, then lead and backing vocals, then de-reverb)
- Export the results as MP3 or FLAC, or send them to Voice Conversion

### Audio: Voice Conversion

- Convert singing or speaking voices into the voice of a chosen voice model (RVC, powered by Applio)
- For songs, separate the accompaniment on the same screen, convert only the vocals and mix them back with adjustable volume balance, reverb and a limiter. When the key changes, the accompaniment is transposed by the same amount
- Compare conversion candidates made with different settings (key, pitch extraction, index influence, volume envelope, consonant protection)
- The screen has three tabs - Convert, Voice Models and Model Training - so voice models can be managed and trained at any time, without loading any audio to convert
- Manage voice models: import RVC models (.pth / .index) with safe loading, export and import models as `.kuravoice` files, and search for models on Hugging Face
- Train your own voice model from recordings made in the app or from audio files (Windows and macOS). Training audio is kept in named training sets, so recording can continue after restarting the app

### Audio: Text to Speech

- Read text or subtitles (SRT / WebVTT) aloud in Japanese, English or Chinese (powered by Style-Bert-VITS2, with JP-Extra and multilingual voice models)
- Control pauses, speed, pitch, volume and readings with control tags (a subset of SSML) checked as you type, set Japanese pitch accents with an accent notation, English pronunciations with IPA and Chinese pronunciations with pinyin
- Subtitle cues are placed at their start times. Cues that do not fit can be sped up, overlapped with the next cue, push the following cues back, or just be reported
- Like Voice Conversion, the screen has Read Aloud, Voice Models and Model Training tabs
- Download ready-to-use voice models (JVNV corpus models) or import Style-Bert-VITS2 models
- Train your own voice by reading the presented sentences aloud, in any order and skipping sentences you do not want to read, kept in named training sets (Windows with an NVIDIA GPU only)
- Send the result to Voice Conversion

### Voice Feature Downloads

Audio Separation, Voice Conversion and Text to Speech need a Python runtime, package sets and models, which are not bundled with the app.

- Open "Downloads" at the top right of each voice feature screen. When something is missing, the screen lists it and opens the downloads with it already selected
- Items are arranged in a tab per feature, in tables labeled "Required", "At least one" or "Optional". Each item shows what it is and which items it depends on. For separation models, recommended combinations for each purpose are shown first
- They are large, so nothing is downloaded until you select items and start the download, and their sizes are shown beforehand
- Shows per-item and overall progress; downloads can be interrupted and retried, and every item can be removed individually
- When an app update needs some items to be downloaded again, the app asks once at startup

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
- Number of threads used to search directories (1-100). It starts at half of the CPU cores (up to 4);
  raising it speeds up the Cleanup search on SSDs, but may slow it down on HDDs or network drives
- Paths to the ffmpeg / ffprobe executables (auto-detected from PATH when not set)
- Storage locations (library, model and work directories), each changed independently. Changing the library or model directory moves its contents to the chosen folder. A folder that already holds a library or model directory (for example, one copied from another computer) can be chosen too: its contents are merged, and for items in both you choose whether to overwrite after comparing their last modified time, file count and size
- Settings are stored in `~/.kura_toolkit/settings.json`

### Required External Tools

Audio Normalizer, Chapter Cut and the voice features (Audio Separation, Voice Conversion, Text to Speech) require [FFmpeg](https://ffmpeg.org/) (ffmpeg / ffprobe). It is not bundled with the app, so install it separately. The app auto-detects it from PATH as well as from common install locations (such as Homebrew on macOS); if it is still not found, set its path in App Settings. SVG Converter and Cleanup do not require any external tools.

The voice features have these additional requirements:

- Transposing the accompaniment (Voice Conversion) and fitting subtitle cues (Text to Speech) need an FFmpeg build that includes the rubberband filter, such as Gyan.FFmpeg from winget on Windows, the Homebrew `ffmpeg` on macOS or your distribution's `ffmpeg` on Linux. The app tells you when the configured FFmpeg lacks it
- An Internet connection to download Python, the packages and the models (several GB in total; the CUDA build of PyTorch alone is about 1.9-2.8 GB)
- Windows: the [Microsoft Visual C++ Redistributable](https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist) (x64)
- macOS: the Xcode Command Line Tools (`xcode-select --install`) to install the Audio Separation package set

## 2. Supported OS

- Windows 10/11
- macOS 12 (Monterey) or later
- Linux (Debian-based / RHEL-based)

Audio Separation, Voice Conversion and Text to Speech are available on Windows 10/11 (x64), on macOS 14 or later with Apple Silicon and on Linux (x64). They use an NVIDIA GPU (CUDA) on Windows and Linux and the Apple Silicon GPU (MPS) on macOS when available, and the CPU otherwise. Training Text to Speech models requires Windows or Linux with an NVIDIA GPU; models trained there can be exported and imported on a Mac.

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
| JVNV voice models                                                    | Text to Speech ready-to-use models           | CC BY-SA 4.0 (inherited from the JVNV corpus)                                                              | https://huggingface.co/litagin/style_bert_vits2_jvnv              |
| ITA corpus (bundled)                                                 | Text to Speech training sentences (Japanese) | Public domain                                                                                              | https://github.com/mmorise/ita-corpus                             |
| CMU ARCTIC prompts (bundled, converted to JSON)                      | Text to Speech training sentences (English)  | CMU ARCTIC license, see [third_party/cmu-arctic/LICENSE.txt](third_party/cmu-arctic/LICENSE.txt) | http://www.festvox.org/cmu_arctic/                                |
| Common Voice zh-CN sentences (bundled, 400 selected)                 | Text to Speech training sentences (Chinese)  | CC0 1.0, see [third_party/common-voice-zh/LICENSE.txt](third_party/common-voice-zh/LICENSE.txt) | https://github.com/common-voice/common-voice                      |
