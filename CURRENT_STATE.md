# Current State

Last updated: 2026-09-08

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
- **UI** — `src/ui/screens/` : welcome, one eleven-photo capture run
  (`ONBOARDING_POSES`, skip offered after 3 quality failures; uncommitted),
  preview with Adjust,
  talk screen, settings.
- **Storage** — `src/store/avatarStore.ts` : IndexedDB, one avatar, no account.
- **Assets** — `npm run setup:models` vendors the landmark model and WASM into
  `public/models/` (gitignored, reproduced by postinstall).
- **Mesh (Stage 2, milestone 1)** — `src/mesh/` : a 37-vertex / 60-triangle
  lower-face mesh (three 12-point rings + a synthetic centroid), per-pose
  geometry re-detected from the *baked* frames, an additive delta solver with
  per-vertex clamping, and a Canvas 2D piecewise-affine warp renderer reusing
  `bake.ts`'s feather mask. Reachable only from the debug-only **Mesh lab**
  screen (`?debug=1` → "Mesh lab"). `StoredAvatar` is now schemaVersion 3
  (`meshGeometry?` is defined but nothing writes it yet).

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

0. **The Stage 2 gate.** Capture an avatar, then open `?debug=1` → **Mesh
   lab** and drag the four sliders. Two things are being judged: whether the
   mesh warp looks like one photograph moving (rather than photos swapping),
   and whether the landmark rings actually sit where they should — the
   inner-lip and jaw/cheek MediaPipe indices were never dot-plotted against a
   real frame, so a ring landing in the wrong place is a live possibility.
   Milestones 2 (speech) and 3 (teeth/tongue/cavity) are deliberately blocked
   behind this looking convincing.
1. `npm install && npm run dev`, open on a phone over HTTPS or localhost, and
   run the full capture → preview → speak loop with a real face.
2. Judge the WIDE and OPEN frames specifically; tune `REGION_*` constants in
   `src/align/region.ts` and the feather fraction if seams or ghosting show.
3. Tune the capture-gate thresholds in `src/align/quality.ts` against real
   shots — they are currently reasoned defaults and are likely too strict or too
   loose in at least one dimension.
4. Stand up the `/api/tts` proxy for Azure. Until then the Web Speech fallback
   runs, which has estimated (not real) viseme timing and noticeably worse sync.
5. **Web Speech punctuation holds (2026-09-13, unit-tested, not yet observed).**
   `src/tts/webSpeechTiming.ts` now parks the mouth at REST at `. ? !` until
   the next word boundary and no longer learns sentence pauses as slow speech
   (see DESIGN_DECISIONS). Verify in Chrome with `?debug=1` on
   "One. Two. Three. Four. Five." — the `speech` row should alternate
   `WORD: One` → `PUNCTUATION HOLD (.) … waiting for "Two"` → `WORD: Two`.
   If the row never shows WORD, the voice sends no boundary events (common on
   Android) and only the estimated REST slot applies.
   **Startup gating (uncommitted):** the clock now waits for `onstart`. On
   "Hello." the row should read `WAITING FOR SPEECH START · …ms` with the face
   at REST until the voice is audible. If it ever reads `STARTED via fallback`,
   that voice does not fire onstart — note which one.

## Codex / delegated work

All delegated slices (alignment, speech, UI, and the Stage 2 mesh lab) are
complete and reviewed. Nothing is in flight. The mesh-lab slice
(`.ai/wo-mesh-lab.json`) is reviewed but **uncommitted** — it is working-tree
only, pending the visual gate above. Review corrections are recorded in
DESIGN_DECISIONS.md and in the commit messages.
