# STEPS

## Where this stands

Phase 1 is done: `server.js`, `lib/parse-script.js`, `public/` (page, css, js),
`tools/test-parse.js`. Self test passes:

```
node tools/test-parse.js "D:/github/agency-os/clients/erfandigital/content/scripts/2026-09-17-closed-loop-agent-reel-v2.md"
```

prints 15 paragraphs, 327 words, OK.

One design note for whoever picks up phase 3 (teleprompter): the `⏸` pause
mark stays inside `paragraph.text` on purpose, because the performer needs to
see it. It is excluded from the `emphasis[]` and `pauses[]` position indices
(those index spoken words only), and it must still never reach burned
captions in phase 6.

## Next step

Start **phase 2** in `SPEC.md`: camera and microphone pickers, live preview,
the input level meter, the one line readiness strip.

Its self test: launch Chrome with `--use-fake-device-for-media-stream
--use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required`,
load the page, assert at least one camera and one microphone are listed, and
the meter value changes across two samples 500ms apart.

## After that

Phases 3 to 5, in order, each with the self test written in `SPEC.md`.
Phase 6 (burned Persian captions) is deliberately not part of this build. The
reason is recorded in `SPEC.md` and it is not an oversight.

## Open items

- Nothing is blocked. The camera and the microphone are connected and were
  seen by the system on 2026-09-22.
- First real recording after phase 3 works: the script
  `2026-09-17-closed-loop-agent-reel-v2.md`, which is written, judged and
  waiting to be recorded.
