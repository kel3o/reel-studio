# STEPS

## Where this stands

Phase 1 and phase 2 are both done.

Phase 1: `server.js`, `lib/parse-script.js`, `public/` (page, css, js),
`tools/test-parse.js`. Self test:

```
node tools/test-parse.js "D:/github/agency-os/clients/erfandigital/content/scripts/2026-09-17-closed-loop-agent-reel-v2.md"
```

prints 15 paragraphs, 327 words, OK.

Phase 2: camera and microphone pickers (`public/devices.js`), live mirrored
preview, the WebAudio level meter with clip and silent warnings, the one line
readiness strip, and `/api/devices-config` so the picker can preselect the
REDRAGON camera and the USB condenser mic by name. Self test:

```
node tools/test-devices.js
```

launches the real server plus headless Chrome with fake devices, and asserts
at least one camera and one microphone are listed and the meter reading
changes across two samples 500ms apart. Chrome's fake microphone is pure
silence by default, so the test synthesizes a short varying tone with ffmpeg
and feeds it in via `--use-file-for-fake-audio-capture`, only to give the
meter something real to move against.

One design note for whoever picks up phase 3 (teleprompter): the `⏸` pause
mark stays inside `paragraph.text` on purpose, because the performer needs to
see it. It is excluded from the `emphasis[]` and `pauses[]` position indices
(those index spoken words only), and it must still never reach burned
captions in phase 6.

A desktop shortcut ("Reel Studio") launches `start.bat`, which starts the
server and opens the page in the browser after two seconds.

## Next step

Start **phase 3** in `SPEC.md`: the teleprompter, per paragraph capture (3
second countdown, record, stop, instant playback, accept or retake), and
`POST /api/clip` saving takes to disk with `session.json` tracking which take
is accepted per paragraph.

Its self test: with fake devices, record three short paragraphs including one
retake, then assert at least four files exist and are non empty,
`session.json` lists exactly three accepted takes, and the accepted take for
the retaken paragraph is the later file.

## After that

Phases 4 and 5, in order, each with the self test written in `SPEC.md`.
Phase 6 (burned Persian captions) is deliberately not part of this build. The
reason is recorded in `SPEC.md` and it is not an oversight.

## Open items

- Nothing is blocked. The camera and the microphone are connected and were
  seen by the system on 2026-09-22.
- First real recording after phase 3 works: the script
  `2026-09-17-closed-loop-agent-reel-v2.md`, which is written, judged and
  waiting to be recorded.
