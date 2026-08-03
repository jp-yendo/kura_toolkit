# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
