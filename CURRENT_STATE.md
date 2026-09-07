# Current State

Last updated: 2026-09-07

## What this is

A mobile-first PWA that makes a user's own photographed face appear to speak
typed text. Five photos (a neutral selfie plus MMM/AHH/EEE/OOO mouth poses) are
registered and baked into five composited frames, which are swapped against a
TTS audio clock. No generative video; nothing about the face leaves the device.

## Implemented

The full pipeline is built and the app compiles, tests and builds clean:
`npm run typecheck` passes, `npm test` passes 18/18, `npm run build` produces a
working PWA (43kB app + 126kB MediaPipe, ~176KB precached shell).

- **Contracts** — `src/core/types.ts` is the frozen interface every module
  implements. `src/core/visemeMap.ts` holds the phoneme/viseme → five-state
  product table.
- **Alignment** — `src/align/` : MediaPipe landmark detection, Umeyama
  similarity registration on rigid anatomy, jaw-inclusive region sizing across
  all five shots, plateau-to-edge feather mask, five-frame baking, capture gates.
- **Speech** — `src/tts/` : Azure provider (via proxy; dev-only direct mode) and
  a Web Speech fallback. `src/core/timeline.ts` builds gapless merged timelines.
- **Playback** — `src/player/` : `PlaybackClock` implementations and
  `LipSyncPlayer`, which derives mouth state from playback position every frame.
- **UI** — `src/ui/screens/` : welcome, five capture steps, preview with Adjust,
  talk screen, settings.
- **Storage** — `src/store/avatarStore.ts` : IndexedDB, one avatar, no account.
- **Assets** — `npm run setup:models` vendors the landmark model and WASM into
  `public/models/` (gitignored, reproduced by postinstall).

## Not yet verified

**Nothing has been run against a real face.** This is the important gap. The
whole pipeline typechecks and its pure logic is unit-tested, but registration
and compositing quality can only be judged on real photographs.

When testing, look at the **WIDE (EEE) frame first** — it is the pose that fails
first, because a smile is wider than the neutral lip contour that sizes the
region. Two defects there were already found and fixed by inspection during
review; a third would not be surprising.

Also unverified on a device: camera capture flow, the quality-gate thresholds
(they are reasoned, not tuned), and lip-sync perception at speed.

## Next steps

1. `npm install && npm run dev`, open on a phone over HTTPS or localhost, and
   run the full capture → preview → speak loop with a real face.
2. Judge the WIDE and OPEN frames specifically; tune `REGION_*` constants in
   `src/align/region.ts` and the feather fraction if seams or ghosting show.
3. Tune the capture-gate thresholds in `src/align/quality.ts` against real
   shots — they are currently reasoned defaults and are likely too strict or too
   loose in at least one dimension.
4. Stand up the `/api/tts` proxy for Azure. Until then the Web Speech fallback
   runs, which has estimated (not real) viseme timing and noticeably worse sync.

## Codex / delegated work

All three delegated slices (alignment, speech, UI) are complete, reviewed and
committed. Nothing is in flight. Review corrections are recorded in
DESIGN_DECISIONS.md and in the commit messages.
