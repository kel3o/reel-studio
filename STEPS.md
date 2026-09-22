# STEPS

## Where this stands

Phases 1, 2 and 3 are done.

Phase 1: `server.js`, `lib/parse-script.js`, `public/` (page, css, js),
`tools/test-parse.js`.

Phase 2: camera and microphone pickers (`public/devices.js`), live mirrored
preview, the WebAudio level meter with clip and silent warnings, the one line
readiness strip, and `/api/devices-config` so the picker can preselect the
REDRAGON camera and the USB condenser mic by name. An orientation toggle
(افقی/عمودی) was added on request: it switches the `getUserMedia` request
between 1920x1080 and 1080x1920 and restarts the preview, so capture itself
can be native vertical instead of only cropped to vertical later in phase 5.
Choice is saved to localStorage (`reel.orientation`) and read back on page
load, the same pattern as the camera and mic pickers. Verified with a fake
device Chrome run confirming the track settings flip both directions and the
saved value is `portrait` after toggling.

Phase 3: the teleprompter and per paragraph capture (`public/capture.js`).
Auto scroll with a speed control and a font size control, current paragraph
bright and the rest dimmed, a 3 second countdown before each take, space to
start or stop, R to retake, Enter to accept and move on. `POST /api/clip`
saves every take to `takes/<slug>/NN-take.webm`, nothing is ever deleted, and
`GET`/`POST /api/session` persist which take is accepted per paragraph in
`session.json` so a stopped session resumes where it left off.

The teleprompter's look was redone on request to match a real teleprompter
page the owner already had (a one off HTML file made earlier, outside this
repo): full screen takeover, a fixed control header (speed, font size,
mirror, restart, close), an eyeline guide near the top, bold orange emphasis
words, the pause mark rendered as a small "مکث" pill instead of the raw
glyph, a start veil with keyboard hints, and a bottom scroll progress bar.
The retake and accept keys stayed exactly as SPEC.md fixed them (space, R,
Enter); only up and down arrow keys for scroll speed were added on top, since
the reference page used R for something else (restart from the top) that
would have collided with our retake key. Two CSS cascade bugs came up while
matching it: `.tp-veil-hidden` and an unconditional `display: block` on the
review video both had a later, more general rule quietly override them; both
are fixed with more specific selectors now (`.tp-veil.tp-veil-hidden`,
`.review-video[hidden]`), and it is worth remembering that pattern (a
`[hidden]`-driven element needs `[hidden]` in its own override selector, not
just a bare class) if new hide or show toggles are added later.

All three self tests pass:

```
node tools/test-parse.js "D:/github/agency-os/clients/erfandigital/content/scripts/2026-09-17-closed-loop-agent-reel-v2.md"
node tools/test-devices.js
node tools/test-capture.js
```

The last two drive a real headless Chrome over the DevTools protocol with
fake camera and microphone devices (shared setup in
`tools/lib/browser-test.js`). `test-capture.js` uses its own tiny fixture
script at `tools/fixtures/sample-script.md` (3 short paragraphs) instead of a
real one, records all three with one retake on the second paragraph, and
asserts on the resulting files and `session.json`.

Two design notes for later phases:

- The `⏸` pause mark stays inside `paragraph.text` on purpose, because the
  performer needs to see it. It is excluded from the `emphasis[]` and
  `pauses[]` position indices (those index spoken words only), and it must
  still never reach burned captions in phase 6.
- `server.js` reads its config path from `REEL_CONFIG_PATH` if that
  environment variable is set, falling back to `config.json`. This is what
  lets the phase 3 self test run against an isolated fixture and temp takes
  folder without touching the real one.

A desktop shortcut ("Reel Studio") launches `start.bat`, which starts the
server and opens the page in the browser after two seconds.

`public/help.html` is an in page guide (linked as "راهنما" from the scripts
list), covering script selection, device setup, the teleprompter, the
keyboard controlled recording flow, and the progress strip. It is not part of
a numbered phase, added on request before starting phase 4.

The recording flow also got a visible record button, plus retake and accept
buttons for the review step, and a small live camera frame in the corner of
the teleprompter so the framing is visible while reading. Space, R and Enter
still do the same things; the buttons are an alternative, not a replacement.
A "پوشه" header button opens the current script's `takes/<slug>/` folder in
Explorer (`POST /api/open-folder`), so there is no need to type the path by
hand to find a clip.

While testing this, `tools/test-devices.js` turned out to read its port from
the real `config.json`, so running it while the app was actually open tried
to bind port 7180 twice, and it once left a fully working orphaned server
process behind after a failed run (found by hand with `netstat`, not
something the test itself reported). Fixed: it now runs on its own isolated
port and config like `tools/test-capture.js` already did, and both use
`taskkill /F /T` for cleanup instead of trusting Node's `child.kill()` alone,
since that once was not enough to actually end the process.

## Next step

Start **phase 4** in `SPEC.md`: server side ffmpeg stitching of the accepted
takes into `out/<slug>-raw.mp4` (re-encode to a common format first, concat,
one pass loudnorm).

Its self test: after three clips, ffprobe the output and assert duration is
within 0.5s of the sum of the accepted clip durations, exactly one video and
one audio stream, video is 30fps constant.

## After that

Phase 5, then phase 7 (end to end acceptance on the real script). Phase 6
(burned Persian captions) is deliberately not part of this build. The reason
is recorded in `SPEC.md` and it is not an oversight.

## Open items

- Nothing is blocked. The camera and the microphone are connected and were
  seen by the system on 2026-09-22.
- First real recording, now that phase 3 works: the script
  `2026-09-17-closed-loop-agent-reel-v2.md`, which is written, judged and
  waiting to be recorded.
- Mid session, the original server process died on its own (cause not
  tracked down) and a stray one from a test run briefly took its place. Both
  are resolved now: the server currently running on port 7180 was started
  cleanly via `start.bat` after the last code change (the open-folder
  button), so it has the latest code. If this happens again, the symptom is
  `start.bat` looking like it does nothing: something is already listening
  on 7180, which now just opens the browser instead of trying to start a
  second server (see the launcher fix above).
- One real recording exists from this session:
  `takes/2026-09-17-closed-loop-agent-reel-v2/01-1.webm`, paragraph 1,
  accepted. Left in place, it is a real take and phase 4 (stitching) can use
  it once it exists.

## Reusable tool candidate

`tools/lib/browser-test.js` (fake camera/mic Chrome launch, a minimal CDP
client over Node's native WebSocket, no npm dependencies) is a generic
getUserMedia/WebRTC feature test harness, not specific to reel-studio. Any
other repo with a camera, microphone, or screen share feature (there is at
least the possibility of more later) could reuse this exact approach instead
of reaching for Playwright or Puppeteer. Not built as a standalone tool now,
just naming it here so it is not reinvented from scratch next time.
