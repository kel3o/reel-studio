# STEPS

## Where this stands

Nothing is built yet. The repo holds the build spec, the repo rules and the
config example. The hardware is bought, connected and verified.

## Next step

Start **phase 1** in `SPEC.md`: the node server, the script loader, and the page
that lists scripts and shows one as numbered paragraphs.

Its self test is fixed and measured from a real file:

```
node tools/test-parse.js "D:/github/agency-os/clients/erfandigital/content/scripts/2026-09-17-closed-loop-agent-reel-v2.md"
```

must assert 15 paragraphs and 327 words.

## After that

Phases 2 to 5, in order, each with the self test written in `SPEC.md`.
Phase 6 (burned Persian captions) is deliberately not part of this build. The
reason is recorded in `SPEC.md` and it is not an oversight.

## Open items

- Nothing is blocked. The camera and the microphone are connected and were seen
  by the system on 2026-09-22.
- First real recording after phase 3 works: the script
  `2026-09-17-closed-loop-agent-reel-v2.md`, which is written, judged and
  waiting to be recorded.
