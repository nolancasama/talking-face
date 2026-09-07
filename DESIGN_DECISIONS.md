# Design Decisions

Durable record of what was decided and why. Newest entries at the bottom.

---

## 2026-09-07 — Project premise: photographed mouth states, not generated video

**Decision.** A talking avatar is built from five photographs of the user's own
face (one neutral selfie + four mouth poses) composited and swapped in time with
TTS audio. No generative video, no neural face model.

**Why.** Deterministic, offline-capable once built, no per-utterance inference
cost, no likeness sent to a third party, and fast enough for a mid-range phone.
The tradeoff is a deliberately limited mouth vocabulary.

**Rejected.** AI talking-head video generation: slow, expensive per utterance,
requires uploading the user's face, and non-deterministic.

---

## 2026-09-07 — Pose alignment is solved from rigid landmarks, never from lips

**Decision.** The similarity transform mapping a pose photo into the neutral
selfie's coordinate space is solved by least-squares (Umeyama) over an
over-determined set of immobile anatomy points: the four eye corners plus the
bony mid-dorsum of the nose (`FaceLandmarks.rigid`).

**Why.** The original plan said to align each crop "relative to the mouth
position in the neutral selfie". That is self-defeating: registering an OPEN
mouth onto the neutral mouth's centre and scale cancels out exactly the
displacement the overlay exists to carry, pulling a dropped jaw back up toward
the closed position. Rigid anchors put the lips where they genuinely are
relative to the skull.

**Amended same day.** The first draft of this decision used the *nose base* as
the third anchor. That is subnasale, sitting directly above the upper lip, and
it is not immobile: an exaggerated OOO purse or a dropped AHH jaw drags both it
and the alar base by a visible amount, which is exactly the error this decision
exists to avoid. The anchor is now mid-dorsum, on bone. The point count also
went from three to five: with a nose point close to the eye line, three points
form a near-collinear triangle that recovers rotation poorly, and a
least-squares fit over more points additionally absorbs per-point landmark
jitter.

**Consequence.** Lip landmarks are still detected, but only to size the crop.

---

## 2026-09-07 — The overlay region reaches the chin

**Decision.** `MouthRegion` is mouth-centred but extends down past the chin
landmark and out to the nasolabial folds, with a wide feather.

**Why.** This is the single largest visual risk in the design. A tight mouth box
fails on the OPEN pose: the jaw has dropped in the photograph, but the base
selfie's chin is still in its closed position, so a small overlay produces an
open mouth floating above an intact closed chin. The overlay has to be large
enough to replace the moving jaw, and feathered enough that its boundary lands
on static cheek and neck.

---

## 2026-09-07 — The five frames are pre-composited at setup

**Decision.** At avatar creation, base + aligned overlay + alpha mask are baked
into five complete frames and stored. Playback composites nothing.

**Why.** Steady playback is then a *single* `drawImage` per frame; only a
crossfade costs two, drawing the outgoing and incoming states at complementary
alpha for 30-60ms. That is what makes this comfortable on a mid-range phone. It also means replay needs no landmarks, no maths and no
network — an avatar works fully offline.

**Consequence.** Re-alignment requires the source photos, which we do not keep
(see below), so the only correction paths are the Adjust nudge applied before
baking and a full retake.

---

## 2026-09-07 — Raw pose photographs are discarded after baking

**Decision.** Only the five baked frames and alignment metadata persist. The
original captures are released once the avatar is built.

**Why.** Privacy — the smallest durable footprint that still works — and
storage. Photographs of a user's face are the most sensitive thing this app
touches; keeping four extra full-resolution ones to enable a re-crop we do not
offer is not a good trade.

---

## 2026-09-07 — Playback is driven by a PlaybackClock, not by HTMLAudioElement

**Decision.** `LipSyncPlayer` depends on a `PlaybackClock` interface
(`nowMs/playing/durationMs/start/stop/onEnd`). `AudioElementClock` implements it
over `audio.currentTime`; a fallback clock implements it over boundary events
plus wall time.

**Why.** The rule that the audio position — never a `setTimeout` chain — is the
master clock is correct and non-negotiable; it is what prevents drift when the
phone drops frames or playback stalls. But binding it literally to
`HTMLAudioElement` forecloses any provider that owns its own playback.
`speechSynthesis` gives neither a buffer nor a position, and it is the only
credential-free way to make noise in a browser. The interface keeps the
guarantee and drops the dependency.

---

## 2026-09-07 — TTS: Azure Speech as reference provider, behind an endpoint

**Decision.** `TTSProvider` is the abstraction; Azure Speech is the reference
implementation because it emits real viseme events with audio offsets alongside
the audio, which is exactly the timing contract this app needs. Credentials are
never bundled. Production has exactly one path to a paid service: our own thin
`/api/tts` endpoint, which holds the subscription key server-side. A direct
browser-to-Azure path exists for local development only and is *enforced* as
such -- it is gated on `import.meta.env.DEV`, which Vite statically replaces, so
the branch is dead code a production bundle cannot execute. A Web Speech
estimator provider exists as a zero-credential fallback.

A static PWA is served to the public; any credential it can read, any visitor
can read. Documenting "dev only" in a comment is not a control, so the policy is
expressed as a compile-time branch instead (`src/tts/config.ts`).

**Why.** Most TTS services return audio only. Guessing timings from text is
visibly worse than real viseme offsets. The fallback exists so the whole capture
→ speak → lip-sync pipeline is demonstrable on day one without an account, and
so the app degrades rather than dies when offline or unconfigured.

---

## 2026-09-07 — F/V map to CLOSED; unshaped tongue consonants map to OPEN

**Decision.** See `src/core/visemeMap.ts`. F and V resolve to CLOSED rather than
the plan's suggested open approximation. T/D/N/K/G/L/TH resolve to OPEN.

**Why.** In F/V the lower lip meets the upper teeth; at a 45ms crossfade a
closed mouth reads much closer to that than an open one. The tongue consonants
have no distinctive lip shape at all, so the honest approximation is whatever
the mouth is already doing mid-word, which is open.

---

## 2026-09-07 — A three-control Adjust panel, not a mouth editor

**Decision.** The preview screen offers X / Y / scale nudges per pose behind an
"Adjust" affordance. No crop editor, no landmark dragging.

**Why.** The plan excluded a manual editor, which is right — but it left
"retake all five photographs" as the only remedy for the most likely failure
mode. Three sliders is cheap insurance, not an editor. The plan's alternative,
"automatic re-alignment if a mouth looks obviously misplaced", was rejected as
an undefined heuristic with no way to tell a misaligned crop from an unusual face.

---

## 2026-09-07 — Capture-time quality gates

**Decision.** A shot is refused at capture time for: no face, multiple faces,
too dark, not frontal (yaw/roll beyond threshold), face scale drifted from the
neutral selfie, or too blurry.

**Why.** Every one of these produces an avatar that looks broken only at the
preview stage, after all five photographs are taken. Catching them at the moment
of capture costs one landmark pass we are running anyway.

---

## 2026-09-07 — Vanilla TypeScript, no UI framework

**Decision.** Vite + TypeScript, hand-written screen router, canvas renderer.

**Why.** Eight screens and one animation surface. A framework would add bundle
weight and a render loop we would have to fight for the one thing that actually
matters here — frame-accurate mouth swapping against an audio clock. The core
modules are pure TypeScript and framework-agnostic regardless.

---

## 2026-09-07 — Face-alignment anchors, feather geometry, and capture gates

**Decision.** Registration uses MediaPipe mesh indices 263/362 (anatomical left
outer/inner eye corners), 133/33 (anatomical right inner/outer eye corners), and
6 (the bony mid-dorsum of the nose). The compositing region is centred on the
outer-lip contour, is at least 2.4 lip-widths wide, starts at least 0.32
lip-widths above the upper lip, and ends at least 0.18 lip-widths below the chin.
Its alpha is an elliptical radial falloff whose feather is 18% of the shorter
region dimension. Capture rejects mean luma below 45/255, absolute yaw above
16 degrees, absolute roll above 12 degrees, inter-ocular drift above 18%, or
mouth-region Laplacian variance below 65 after limiting analysis to 192 pixels.

**Why.** The four canthi and mid-dorsum are stable against lip pursing and jaw
drop while still giving an over-determined, non-collinear similarity fit. The
wide, over-tall ellipse puts its transition on relatively static cheek/neck
skin, fully replaces the neutral chin during OPEN, and has no rectangular
corners to reveal exposure or registration differences.
The capture thresholds leave room for ordinary handheld variation but reject
conditions where a 2D registration or the feather cannot conceal the error;
normalizing blur analysis prevents image resolution alone changing that gate.

**Rejected.** Lip, subnasale, alar-base, and nose-tip anchors because speech
moves them; a tight mouth rectangle because it leaves the neutral chin visible;
and a box/linear-edge mask because its corners and straight seams remain
perceptible.

---

## 2026-09-07 — Mask falloff moved to the region edge; region sized from all poses

**Decision.** Two corrections to the entry above, made during review of the
alignment implementation.

1. The overlay alpha mask is an opaque plateau that ramps to zero only within
   `feather` px of the region **boundary** (a smoothstepped per-axis ramp whose
   product rounds the corners), replacing the elliptical radial falloff measured
   from the region centre.
2. The region is sized from the union of all five shots' lip contours and chin
   points — each pose mapped into neutral space through its own registration
   transform — rather than from the neutral selfie alone.

**Why.** Both defects converged on the same failure, and it landed on the worst
possible pose. With a centre-weighted radial falloff at typical face
proportions, the mask was fully opaque only to a 26px half-width at the upper
lip line, while an EEE smile reaches roughly 32.5px. The corners of the smile
therefore fell in the falloff and ghosted back toward the neutral closed mouth —
and wide corners are the entire point of the WIDE pose. The plateau mask gives
44px of full opacity uniformly across the lip span.

The radial falloff was also conceptually misplaced: the region is deliberately
sized so its *edge* lands on static skin, so that edge is exactly where the
feather belongs. Spreading it inward from the centre spends the softness on the
lips, which is the one part that must be fully replaced.

Sizing from the neutral shot alone under-covers by construction — the poses
exist precisely because they are more extreme than neutral, so the neutral lip
contour cannot predict their extent.

**Rejected.** Simply widening the region to buy margin: that pushes the boundary
onto the moving jawline, trading a ghosted smile for a visible seam.

---

## 2026-09-07 — Web Speech estimator: vowel-weighted duration and inter-word gaps

**Decision.** `estimate()` in `src/tts/webspeech.ts` now gives vowel-mapped
letter groups a heavier share of a word's estimated duration (1.7x a
consonant's) instead of splitting time evenly per letter, and inserts a short
gap (55ms, speed-scaled) between words. Also fixed `H` resolving to a literal
`'H'` token, which is not a `PHONEME_TO_MOUTH` key (the table has `HH`) and
silently fell to the OPEN fallback by accident rather than by the fallback's
own design.

**Why.** Reported symptom: speaking a real sentence "only opened and closed
the mouth." Root cause was duration, not mapping. English text is consonant-
heavy, and this app's own five-state approximation already sends most
unshaped tongue consonants (T/D/N/K/G/L/H) to OPEN by design (see the
F/V-to-CLOSED decision above). Splitting a word's duration evenly by letter
gave every one of those OPEN-mapped consonants the same slice as the word's
vowel, which is where CLOSED/WIDE/ROUND actually come from. At a 45ms
crossfade an ~72ms span is barely on screen, so vowel shapes read as
imperceptible flickers against a dominant OPEN. Weighting toward vowels -- the
same skew real speech has, since vowels are held and consonants are quick --
gives WIDE/ROUND/CLOSED spans in the 90-140ms range for ordinary words, well
clear of both the crossfade and the MIN_SPAN_MS merge floor. The inter-word
gap adds a REST beat between words so the animation reads as speech rather
than one continuous span.

**Consequence.** This is still a heuristic over English orthography, not real
phonetics -- it does not know a word's true pronunciation, only approximates
one letter at a time. It is measurably better, not solved. The real fix
remains a provider with genuine viseme timing (Azure, once `/api/tts` is
deployed); this estimator only exists so the pipeline works with zero
credentials.

---

## 2026-09-07 — Web Speech clock re-anchors on word boundaries, ignoring elapsedTime

**Decision.** `SpeechSynthesisPlayback` no longer reads
`SpeechSynthesisEvent.elapsedTime`. On each word boundary it re-anchors the
clock to that word's own estimated start position, and learns a `paceScale`
from consecutive boundaries to interpolate between them.

**Why.** `elapsedTime`'s unit is not reliable across engines -- the spec says
seconds, but browsers have shipped milliseconds. The previous code did
`elapsedTime * 1000`, so under the millisecond reading the anchor came out
1000x too large. `positionMs()` clamps to the estimated duration, so the very
first word boundary parked the clock on the timeline's trailing REST span for
the remainder of the utterance: the avatar opened its mouth once, closed it,
and went still while the voice kept talking. It presented as "it only opens
and closes."

The event's timestamp was never actually needed. The boundary already carries
the fact that matters -- *this word is starting now* -- and the timeline is
frozen in estimate coordinates, so that word's estimated start is the correct
anchor. This removes the cross-browser unit ambiguity entirely rather than
trying to detect which unit was meant.

`paceScale` exists because the character-count estimate is routinely off by a
large factor from a voice's real speed (measured around 0.63 on a typical
sentence). Without it the mouth completes the whole timeline well before the
audio finishes. It is clamped to [0.25, 4] so a repeated or out-of-order
boundary cannot produce a wild or negative rate.

**Also fixed.** The correction used to mutate the `SpeechCue` objects.
`buildTimeline` copies the spans it derives, so those mutations changed
nothing that renders -- dead code against a frozen timeline. The cue
dependency is gone.

**Residual limitation.** Drift within a single word is still bounded only by
that word's length, and the first word runs on an unlearned pace. Real viseme
timing from a provider remains the actual fix; this estimator exists so the
pipeline works with no credentials.
