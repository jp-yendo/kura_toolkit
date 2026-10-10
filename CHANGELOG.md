# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- SVG Converter: presets, resizing and background removal before converting, grayscale conversion, path optimization, and cancelling a conversion.
- SVG Auto Converter, which finds conversion settings automatically.
- SVG Converter: a number box next to each slider for typing an exact value.

### Changed

- SVG Converter: the default color precision is higher.
- SVG Converter: choose the image first, then switch it with the Change button or by dropping another image anywhere.
- SVG Converter: the original and the result are shown one above the other, zoom together with the mouse wheel, and show the path count and file size.

### Fixed

- SVG Converter: when an image cannot be converted with the current settings, the message now says which settings to change.
- SVG Converter, Audio Normalizer and Chapter Cut: moving to another feature now clears the chosen files and results, like other features.

## [0.3.1] - 2026-10-09

### Changed

- macOS: Audio Separation & Processing is no longer limited to macOS 14 or later on Apple Silicon. On Intel Macs and
  macOS 13 or earlier, the processing that does not use a model (noise removal without a model, silencing the noise
  in silent parts, matching the volume and effects) can be used. Voice Conversion and Text to Speech still require
  macOS 14 or later on Apple Silicon.
- Windows: after the NVIDIA GPU is removed (or is no longer detected), the voice feature packages no longer have to
  be downloaded again. They keep working on the CPU.

### Fixed

- Audio Normalizer: when FFmpeg cannot be found or cannot be started, analyzing and normalizing now show
  an error message instead of only marking each file with "!".

## [0.3.0] - 2026-10-08

### Added

- Audio Separation, Voice Conversion and Text to Speech (Japanese, English and Chinese), with voice model
  management, model training and downloads of what they need. Available on Windows (x64), macOS 14 or
  later (Apple Silicon) and Linux (x64).
- App Settings: storage locations and how long unused cache files are kept.

### Changed

- The license changed from MIT to the GNU Affero General Public License v3.0 (AGPL-3.0).
- Only one copy of the app runs at a time.
- App Settings: "Search threads" no longer has an upper limit.
- Audio Normalizer: files can be saved as MP3, FLAC, Ogg Vorbis, Opus, AAC, WAV or ALAC as well as in
  their original format, file details are shown as soon as files are added, and progress and time left
  are shown more accurately.
- Chapter Cut: intermediate files are kept in the work directory, and the time left is shown.

### Fixed

- An unreadable settings file is no longer overwritten; the app asks what to do at startup.
- In the dark theme, scroll bars inside lists and text boxes are dark as well.
- Audio Normalizer no longer changes the balance between quiet and loud parts of a song.
- Audio Normalizer and Chapter Cut: closing the app while working no longer leaves temporary files, and
  the existing file is kept when overwriting fails or is cancelled.

## [0.2.1] - 2026-08-27

### Added

- App Settings: a "Search threads" setting controls how many threads are used to scan directories.
  It starts at half of the CPU cores (up to 4) and accepts any value from 1 to 100.

### Changed

- Cleanup: the search is far faster - about 7 times on a whole user profile with the default
  setting, and more with a higher thread count. Folders holding tens of thousands of files no
  longer hold the rest of the search back.
- Cleanup: while searching, the dialog shows how many directories have been searched and how many
  items were found, and "Show details" lists what each thread is currently scanning. There is no
  progress bar any more, because a search cannot tell in advance when it will finish.
- Cleanup: cancelling a search now takes effect immediately.
- Progress dialogs throughout the app are tighter: the empty space below the text is gone and the
  buttons line up with the rest of the content.

### Fixed

- Cleanup: cancelling a search could report "no items found" instead of reporting it as cancelled.

## [0.2.0] - 2026-08-03

### Added

- Audio Normalizer: add whole folders at once, either with the new "Add Directory" button or by
  dropping a folder on the list. Sub-folders are searched as well and every supported audio file is
  added in name order.
- Chapter Cut: a "File Information" button next to the chapter list shows what was found in the
  loaded file - format, duration, chapter count and every video, audio and subtitle track with its
  codec, resolution, channels, bitrate and language.
- SVG Converter: the original image and the SVG preview can now be resized against each other by
  dragging the divider between them.
- SVG Converter: the SVG preview can be zoomed with the buttons next to its heading or with
  Ctrl + mouse wheel, and dragged around when it does not fit in the frame.

### Changed

- Overwriting is never silent any more. Audio Normalizer and Chapter Cut check the output location
  before they start and list the files that would be replaced, so you can cancel first.
- Audio Normalizer: the output directory may now be left empty, which writes the result next to the
  input file and replaces the original (after the confirmation above). The original file is kept if
  the conversion fails or is cancelled.
- Audio Normalizer: files with the same name that would end up on the same output path are refused
  with an explanation instead of quietly overwriting each other.
- Chapter Cut: if the video carries image based subtitles, the result is saved as mkv even when the
  source is mp4, because those subtitles do not play back correctly in mp4. A dialog explains this
  and shows the resulting file names before anything is written.
- Chapter Cut: the output file field now takes a file name instead of a full path, and the file is
  always created in the output directory. Pasting a path moves the folder part into the output
  directory field, and leaving out the extension keeps the one of the input file.
- Chapter Cut: the log is no longer shown on the screen; it can be opened from the completion dialog
  when you need the details.
- Dialogs no longer close when you click outside them, so results and confirmations cannot be
  dismissed by accident.
- Settings are only remembered where it helps: Audio Normalizer stores its output settings when you
  actually run analyze or normalize, while Chapter Cut and SVG Converter always start from their
  defaults.
- Layout: the file list in Audio Normalizer and the chapter list in Chapter Cut fill the free space
  and scroll inside their own frame, so the buttons and output settings always stay visible. The
  drop area in Chapter Cut covers the whole screen until a file is loaded.

### Fixed

- Chapter Cut: subtitles now work in the cut and split results. They used to be missing entirely, or
  to appear several seconds off, or - for DVD style subtitles - to be drawn oversized in the wrong
  colours. Subtitles are now cut separately and merged back in sync, keeping their language, title,
  display size, colours and their default/forced flags.
- Chapter Cut: chapter marks are placed correctly for files that start a little earlier than the
  requested cut point (common with mkv); they could be off by several seconds before.
- Chapter Cut: the title, author, description and other information of the source file is kept in
  the result - for every part when splitting.
