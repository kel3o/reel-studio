# Build spec: reel-studio

A local recording studio for one person's Persian vertical reels. Written for the
agent session that will build it. No em dash anywhere in code, UI text, comments
or generated files: this is a standing rule of the owner and it applies to every
string this tool produces.

---

## 0. GOAL

**Human task this replaces.** Today a reel costs: open OBS, check sources, record
one long take, restart the whole take on every stumble, open Camtasia, crop to
vertical, place the top image, type captions by hand, export. The owner has said
plainly that fighting these two programs is the part that stops him.

**Success, in priority order.**

1. From opening the page to a publishable vertical mp4 with burned Persian
   captions, without opening any other program.
2. A fumbled paragraph costs one retake of that paragraph, never the whole take.
3. Audio provably comes from the chosen condenser microphone, visible on a level
   meter before the first paragraph is recorded.
4. Nothing paid, nothing online. It runs with the network off.

**Non-goals.** A general editor. A timeline. Transitions, effects, filters,
music. Multi camera. Streaming. Uploading to Instagram. Subtitles in any
language but Persian. Reading script formats other than the one in section 3.1.
Anything that needs a login.

---

## 1. What it is

A static page in the browser plus a small local server.

The browser does what only a browser does well: camera and microphone capture,
live preview, the teleprompter, and MediaRecorder. The server does what a
browser cannot: read the script files from disk, write clips, and run ffmpeg and
the local transcription model.

The owner opens one shortcut, picks a script, records, and gets two files.

---

## 2. Hard constraints

- **Runtime already on the machine** (verified 2026-09-22):
  ffmpeg 8.1.2 full build (gyan), node v26.4.0, python 3.14.6.
  Resolve `ffmpeg` from PATH. If it is missing, show a Persian message naming
  what to install; never crash with a stack trace.
- **Free first.** No paid API, no cloud transcription, no CDN. Every asset,
  font and script file is local, so the page works with the network off.
- **Transcription is local**, with faster-whisper and the **large-v3** model.
  Never silently downgrade the model: on an out of memory error, retry the same
  model on CPU and say so in the UI. Clips are short, so process one at a time.
- **Persian, right to left UI.** Short plain words, no formal register.
- **No em dash** in any file this tool writes, including .ass subtitles and
  session records.
- **Local only.** Server binds 127.0.0.1. No auth, no remote access.
- Chrome or Edge is the target browser. Camera access requires a secure context,
  so the page is always served over http://127.0.0.1:PORT, never opened as a
  file:// path.

---

## 3. Architecture

```
reel-studio/
  server.js            node http server, no framework
  public/              the page, css, js, fonts, no build step
  lib/
    parse-script.js    script file to paragraphs
    ffmpeg.js          stitch, vertical render, burn subtitles
    whisper.py         transcribe one clip, word timestamps out
    align.js           whisper words to script words, ground truth wins
  assets/              top frame images the owner drops in
  takes/               raw per paragraph clips (gitignored)
  out/                 finished files (gitignored)
  config.json          gitignored
  config.example.json  checked in
  tools/               the self tests named in each phase
```

### 3.1 The input format, fixed and not negotiable

Script files are the ones already in use, for example
`clients/erfandigital/content/scripts/2026-09-17-closed-loop-agent-reel-v2.md`.

- The spoken text is everything between the line `## متن` and the next `## `
  heading. Nothing else in the file is ever spoken.
- Paragraphs are separated by a blank line. One paragraph is one clip.
- `**word**` marks emphasis. The parser strips the asterisks for display and
  keeps the positions, because phase 6 highlights these words in the captions.
- `⏸` is a pause mark for the performer. It is never spoken, never displayed in
  captions, and never counted as a word.

---

## 4. Phases

Each phase ends with a self test that is a real command with a real assertion.
A phase is not done until its test passes.

### Phase 1: skeleton and script loader

Build `server.js` serving `public/` on 127.0.0.1 (default port 7180, override in
config), plus:

- `GET /api/scripts` lists .md files in the configured scripts folder, newest
  first, with title and paragraph count.
- `GET /api/script?path=` returns `{ title, paragraphs: [{ text, emphasis[],
  pauses[] }] }` per section 3.1.

The page lists the scripts and shows the chosen one as numbered paragraphs.

**Self test.** `node tools/test-parse.js <path to the v2 script>` must print and
assert: exactly **15 paragraphs**, **327 words** total, no paragraph containing
`##` or `**`, and the last paragraph starting with `ایجنت برای این نیست`.
Those numbers are measured from the real file and are the fixture.

### Phase 2: devices and monitoring

- Camera and microphone pickers from `enumerateDevices`, remembered in
  localStorage, re enumerated after permission is granted so labels are real.
- Live mirrored preview. Request 1920x1080 at 30fps and display what was
  actually granted, because a webcam that quietly gives 640x480 must be visible
  before recording, not after.
- A live input level meter from a WebAudio AnalyserNode, with a clip warning
  above -3 dBFS and a "silent" warning if the peak stays under -45 dBFS for
  three seconds. This is the condenser check: he must see the bar move.
- A one line readiness strip: camera name, resolution, microphone name, level.

**Self test.** Launch Chrome with `--use-fake-device-for-media-stream
--use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required`, load
the page, and assert the page lists at least one camera and one microphone, and
that the meter value changes across two samples 500ms apart.

### Phase 3: teleprompter and per paragraph capture

- Large RTL text, the current paragraph bright, the neighbours dimmed, auto
  scroll with a speed control and a font size control.
- **Known bug to avoid, already paid for once:** accumulate scroll position as a
  float and assign it to `scrollTop`. Adding a sub pixel delta directly to
  `scrollTop` truncates to zero, and slow speeds stop moving.
- Per paragraph flow: 3 second countdown, record, stop, instant playback of that
  clip, then accept or retake. Keyboard: space starts and stops, R retakes the
  current paragraph, Enter accepts and moves to the next.
- `POST /api/clip` saves the blob as `takes/<script-slug>/NN-<take>.webm`.
  Every take is kept. `session.json` records which take index is accepted for
  each paragraph, so a retake never destroys a good earlier one.
- A progress strip shows which paragraphs are done, so he can stop and come back.

**Self test.** With fake devices, record three short paragraphs including one
retake, then assert: at least four files exist and each is larger than zero
bytes, `session.json` lists exactly three accepted takes, and the accepted take
for the retaken paragraph is the later file.

### Phase 4: stitch and the raw file

Server side ffmpeg:

- Re encode every accepted clip to a common format before concat: H.264,
  constant 30fps (`-vsync cfr -r 30`), same resolution, AAC 48kHz. Browser webm
  is variable frame rate and concatenating it without this produces drift.
- Concat in paragraph order, then one pass `loudnorm` on the audio. No noise
  gate, no compressor, no de-esser: a condenser in a quiet room does not need
  them and they cost his voice.
- Write `out/<script-slug>-raw.mp4`.

**Self test.** After three clips, `ffprobe` the output and assert: duration is
within 0.5s of the sum of the accepted clip durations, exactly one video and one
audio stream, video is 30fps constant.

### Phase 5: the vertical file with the top frame

- Canvas 1080x1920. Top 1080x1080 is the image area, the rest is him, centre
  cropped from the 16:9 source and scaled to fill.
- `assets/` holds the images. In the UI he assigns an image to a paragraph
  index, so **the top frame can change mid video**: the two valleys reel needed
  exactly this and any version without it forces a second program again.
- A thesis card: short Persian text drawn over the top image for the first N
  seconds, N configurable, default 4. Text comes from a field in the UI and is
  saved into `session.json`.
- If no image is assigned, the top area is a flat colour from config, never a
  black hole and never a crash.

**Self test.** Assert the output is exactly 1080x1920. Assign different images to
paragraph 1 and paragraph 3, then extract one frame from inside each of those
paragraphs and assert the two frames differ (mean absolute difference above a
threshold), proving the top frame actually switched.

### Phase 6: NOT IN THIS BUILD, burned Persian captions

Captions were in this spec and were **deliberately taken out on 2026-09-22**,
by the owner, with a reason that changes the design and must not be forgotten:

> «من ممکنه بعضی کلمات رو جابه‌جا کنم تو اجرا.»

He does not perform the script word for word. He moves words around while
recording. So the first design, which took timing from the audio and spelling
from the script, was wrong: it would print sentences he did not say. Captions
therefore have to come from what the microphone actually heard, and Persian
transcription is good but not clean enough to burn unread. That means a human
review screen before burning, and a review screen is not a one click feature.
He edits captions in his editor for now.

**What this build must still do so captions can be added later with no rework:**

1. Keep every accepted clip on disk, per paragraph, with its own audio. Do not
   delete `takes/` after rendering.
2. Keep `session.json` with, per paragraph: the script text, the accepted take
   filename, and its start offset in the stitched timeline. That offset is what
   a later caption pass needs and it is nearly free to record now.
3. Keep the vertical render as its own server side step with its own entry
   point, so a caption burn can be inserted before it without touching phases
   1 to 4.

When it is built, the shape is: transcribe each clip locally with faster whisper
large-v3, language fa, word timestamps, one clip per process, never a smaller
model. Use the script text only as a **spelling hint** where a heard word and a
script word clearly match, never as an override. Show him the caption lines in a
review panel, let him fix them, then render `subs.ass` and burn it into the
vertical file only, leaving the raw file clean.

### Phase 7: end to end acceptance

Run the whole thing on the real script
`2026-09-17-closed-loop-agent-reel-v2.md` with fake devices, recording a short
placeholder for each of the 15 paragraphs.

Expected, all asserted, no manual inspection:

1. `out/<slug>-raw.mp4` exists, plays, has 15 paragraphs worth of duration.
2. `out/<slug>-vertical.mp4` exists and is exactly 1080x1920.
3. `session.json` holds, for all 15 paragraphs, the script text, the accepted
   take filename and its start offset in the stitched timeline. This is what a
   later caption pass will read, so it is asserted now while it is cheap.
4. `takes/` still holds every clip after both renders finish.
5. No step required any program other than this one, and no network call was
   made. Verify the second half by running the whole test with the network
   adapter disabled.
6. Print the wall clock time of the render so regressions in speed are visible.

---

## 5. Config and privacy

`config.json`, gitignored, with a checked in `config.example.json`:

```json
{
  "port": 7180,
  "scriptsDir": "D:/github/agency-os/clients/erfandigital/content/scripts",
  "outDir": "./out",
  "takesDir": "./takes",
  "assetsDir": "./assets",
  "ffmpeg": "ffmpeg",
  "whisper": { "model": "large-v3", "device": "auto", "python": "python" },
  "topFrameFallbackColor": "#0d0f12",
  "accentColor": "#ffc46b"
}
```

`.gitignore`: `config.json`, `takes/`, `out/`, `assets/`, `__pycache__/`.

Missing or malformed config shows a Persian message naming the missing key and
offering to copy the example file. It never crashes and never writes into the
scripts folder.

---

## 6. Repo

New repo at `D:\github\reel-studio`, default branch `main`, work committed there
directly. It is his own tool on his own machine, so no secrets are expected, but
the config file stays gitignored anyway in case the scripts path or anything
else personal ends up in it.

---

## 7. Order of work, and what to do if time runs short

Phases 1 to 4 are the tool. If the session has to stop early, stopping after
phase 4 still leaves something better than OBS, because the retake per paragraph
problem is solved and a clean raw file comes out.

Phase 5 removes the crop and the top image from his editing. After it, the only
thing left in his editor is captions, and that is a deliberate choice, not an
omission: see phase 6.

Do not reorder, and do not start the caption work in this build even if there is
time left. Time left goes into making phases 1 to 5 fast and boring to use.
