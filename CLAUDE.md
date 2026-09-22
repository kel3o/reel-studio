# reel-studio

A local recording studio for Erfan's Persian vertical reels. Teleprompter,
webcam and condenser microphone capture, paragraph by paragraph recording with
automatic stitching, and two outputs: a clean raw file and a publishable 9:16
file with a top frame.

**`SPEC.md` is the build order.** Read it before writing any code. It is phased
and every phase carries its own self test. A phase is not done until its test
passes, and phases are not reordered.

## Rules that apply to every file in this repo

- **No em dash, in any language, anywhere**: not in code, comments, UI strings,
  commit messages or generated files. Use a comma, a colon, parentheses, or two
  sentences.
- **UI is Persian and right to left.** Short spoken words, no formal written
  register, no translated English constructions.
- **Everything is local.** No CDN, no external font, no API, no login, no
  telemetry. The page must work with the network adapter disabled, and the
  acceptance test checks exactly that.
- **Commit to `main` directly.** No branches. Commit each finished phase with a
  one line message naming the phase.
- **Do not touch the scripts folder.** It belongs to another repo. This tool
  reads from it and never writes into it.

## The machine it runs on (verified 2026-09-22)

- ffmpeg 8.1.2 full build (gyan), on PATH
- node v26.4.0
- python 3.14.6, with faster-whisper already installed and used by the `goosh`
  tool elsewhere on this machine
- Camera: **REDRAGON Live Camera** (the built in HP Wide Vision HD Camera is
  broken and returns a black picture, so it must never be the default)
- Microphone: **Microphone (2- USB Condenser Microphone)**

Those two device names are the defaults the picker should preselect when it
finds them. The picker still lists everything, because hardware changes.

## Who this is for

One person, on one laptop, recording one kind of video: a Persian explainer reel
of roughly 60 seconds, read from a teleprompter, published to Instagram. Every
feature that does not serve that exact video is out of scope. `SPEC.md` names
the non goals and they are real, not decoration.
