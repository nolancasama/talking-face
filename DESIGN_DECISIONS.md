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

---

## 2026-09-07 — Continuous articulation over five reference frames (Stage 1)

**Decision.** The five baked frames become reference *extremes* rather than the
only renderable states. `src/core/articulation.ts` describes the mouth as four
continuous controls (jawOpen, lipWidth, lipRound, lipClosure), smoothed
per-control at different rates, and resolved to blend weights over at most two
reference frames. Adds a 50ms anticipatory visual lead, cuts the frame
crossfade from 45ms to 18ms, and makes a span's *commitment* proportional to
its duration.

**Why.** Swapping complete photographs at phoneme speed moves jaw, chin,
cheeks, skin texture and lighting simultaneously, which reads as photographs
being swapped rather than a face speaking. Three separate mechanisms attack
that: partial commitment stops brief phonemes triggering full photographic
swaps at all; differential smoothing keeps the jaw (90ms) slower than the lips
(45ms), since a real jaw cannot re-articulate per consonant; and the much
shorter crossfade limits the double-lips/double-teeth ghosting that
alpha-blending two mouth photographs inevitably produces.

Closure is exempt from partial commitment and smoothed fastest (28ms). Lips
meeting for M/B/P is the most legible event this five-state model can express,
and a half-committed M reads as a bug rather than as restraint.

**Rejected for now: shrinking the replacement region.** The plan proposed
reducing the crop so less of the lower face is swapped. That re-introduces a
fixed defect: with a tight region the OPEN pose puts a dropped jaw over the
base photo's intact closed chin. The region can only shrink once geometric jaw
warping can move the chin, which is Stage 2.

**Deferred to Stage 2: geometric landmark warping.** It is the right answer to
the underlying problem -- with five welded frames, jaw and lips are literally
the same pixels and cannot be separated post-hoc. It is blocked on geometry we
do not store: `StoredAvatar` holds five flattened PNGs, and the raw pose photos
are deliberately discarded after baking. The unblock is to re-detect lip
contours from the baked frames themselves (they are aligned photographs) at
load time, which needs no re-capture -- but it is a schema change, not a
rendering tweak, and it should follow evidence from Stage 1 rather than precede
it.

**Post-implementation finding.** Tracing "Hello, how are you?" through the built
pipeline showed the merged `OPEN@0-264` span holding the jaw at maximum gape
for a quarter second. OPEN does double duty -- the wide AHH vowel and the
fallback for every consonant with no distinctive lip shape -- so a consonant
run renders at full AHH. `POSE_ARTICULATION.OPEN.jawOpen` dropped 1.0 -> 0.8
in response.

That adjustment is, however, mostly latent in Stage 1: with pure frame
blending the parameters reach the screen only through `poseWeights`, and a
sustained OPEN span still resolves to OPEN at weight 1 and draws the AHH
photograph outright. `jawOpen` gains an independent rendering effect only when
Stage 2 gives it geometry to drive. The honest Stage 1 fix for the remaining
over-articulation is to let the mapper carry an intensity alongside the state,
so an OPEN from a consonant fallback commits less far than an OPEN from a true
open vowel -- no new photographs, just a continuous weight. Deliberately not
done yet: it is a contract change across the mapper, timeline and renderer,
and it should follow visual evidence rather than precede it.

---

## 2026-09-08 — Stage 2 milestone 1: mesh-warp slider proof of concept

**Decision.** Add a debug-only Mesh lab that re-detects MediaPipe landmarks on
the already-baked REST, CLOSED, BIG_OPEN, WIDE, and ROUND frames, builds a
37-vertex/60-triangle mouth-and-jaw mesh, and warps the user's REST photograph
with four independent sliders. The target solver adds the four reference-pose
deltas and limits each combined vertex displacement to the largest movement
seen for that vertex in a single reference pose. The resulting canvas is
clipped with the existing mouth-region feather rather than introducing a new
seam algorithm.

The candidate landmark arrays remain
`[61,40,37,0,267,270,291,321,314,17,84,91]`,
`[78,80,82,13,312,310,308,318,317,14,87,88]`, and
`[205,187,214,172,136,152,434,397,365,378,411,425]`; no substitutions were
made. Real-frame dot-plot confirmation is still pending because no locally
captured baked avatar frames were available in the implementation workspace,
so this entry does not claim visual verification that did not occur.

**Why.** Geometry lets jaw, chin, cheeks, and lips move at different amounts
without crossfading two complete photographs, while summing deltas preserves
co-occurring articulators such as jaw opening and lip widening. This milestone
is deliberately isolated behind the development-mode screen. LipSyncPlayer,
the timeline, and TTS are untouched; production playback continues using the
existing baked-frame renderer until a human judges the mesh deformation on a
real captured face and explicitly gates a later milestone.

---

## 2026-09-13 — Web Speech clock: punctuation holds and barrier-aware pace learning

**Decision.** Web Speech timing moved into `src/tts/webSpeechTiming.ts`
(`WebSpeechTimingClock`, pure, injected `now()`). Authority order is now
*actual word boundary > punctuation barrier > learned pace > character
estimate*.

- The estimator classifies the text between each pair of words from the
  original string: `. ? !` (and `…`) are **hard** barriers, `, ; :` and dashes
  are **soft**. Each widens the inter-word gap into a REST slot (hard ≥188ms,
  soft ≥95ms estimate-time). Decimal points and thousands separators are not
  barriers.
- Once the engine has sent at least one boundary, the clock **parks** at a
  barrier — at `next.startMs − VISUAL_LEAD_MS − 1`, so the player's lookahead
  still lands on REST — and waits for the next word's boundary, which
  re-anchors it to that word's start. A hard hold has only a 2s safety release
  (for a dropped boundary); a soft hold releases after 400ms. The slot length
  is not the pause length; the voice decides that.
- `paceScale` is learned only from **adjacent word pairs with no barrier
  between them**, as a log-space moving average (α 0.35), and never across a
  pause/resume. Previously every boundary pair overwrote it, so a sentence
  pause between `you?` and `I` read as a 4× slower voice for the next
  sentence, and a single short word swung it wildly.
- Duplicate or out-of-order boundaries are ignored rather than re-anchoring
  backwards; a charIndex on the punctuation/space before a word maps to the
  following word.

**Why.** No boundary fires during a sentence pause, so the old clock
free-ran through the estimate's 55ms gap into the next sentence, then snapped
backwards when that sentence's first boundary arrived (the player treats a
backwards clock as a hard reset), and learned the silence as slow speech.

**Rejected.** A fixed per-punctuation pause (e.g. period = 400ms) as the
primary mechanism: voices differ and the boundary already tells us when speech
resumes. Holding the utterance to wait for the face: the audio is the master.
Capping the clock at every ordinary word start: it would change behaviour for
unpunctuated text and freeze the mouth whenever the estimate runs ahead;
revisit only with evidence.

---

## 2026-09-13 — Web Speech clock epoch is utterance.onstart, not speak()

**Decision.** `WebSpeechTimingClock` now has a waiting state. `start()` (called
right before `speechSynthesis.speak()`) only records the request; position
stays 0 until the engine reports speech has begun. The epoch is set by, in
order of preference: `utterance.onstart`; a word boundary that arrives first
(it proves speech started; the anchor places the clock, and a later onstart is
ignored so the clock never moves back); or a 2s safety fallback if neither
arrives (pause time excluded). A late onstart corrects a fallback start as long
as no boundary has anchored yet. The estimate also begins with a
`START_REST_MS` (51ms) REST slot, sized from `VISUAL_LEAD_MS`, so the player's
50ms lookahead from a waiting clock lands on REST instead of the first sound.

**Why.** The epoch was the moment speak() was requested, so the face ran
through the engine's queue/voice-load latency (hundreds of ms) before any
audio. Even a frozen clock would not have been enough: the first word started
at 0ms, so position 0 + 50ms lead already showed its first sound.

**Rejected.** A fixed startup delay (latency varies per voice and per call).
Removing or changing VISUAL_LEAD_MS (it is not the cause; judged separately).
Guarding in LipSyncPlayer (kept inside the Web Speech layer).

---

## 2026-09-13 — Onboarding captures all eleven poses in one run

**Decision.** First-time capture is one continuous sequence of all eleven poses
(`ONBOARDING_POSES`, "Photo N of 11"), straight into preview. The post-core
"Your talking face is ready! / Add Extra Lip Shapes" decision card is gone.
`CORE_POSES`/`EXTENDED_POSES` stay as data-model tiers: storage, baking and the
renderer still accept any subset containing REST, existing avatars load
unchanged, and Settings → "Improve lip sync" still captures only the poses an
older avatar is missing. Capture now shows a title and an instruction per pose
plus a standing "keep your head still" hint. After three consecutive
quality-gate rejections on one pose (never REST) a quiet "Skip this photo" link
appears; the gate itself is unchanged.

**Why.** Offering the extended poses as a bonus after "ready!" meant most
avatars would never get them, and the extended poses (TH, TEETH_LIP, SH_CH, L,
OPEN_ROUND) are exactly the ones the renderer otherwise has to approximate.
The earlier rationale (eleven photos is long; bad TH frames look worse than an
approximation) is answered by the skip escape rather than by making the poses
opt-in.

**Rejected.** Making all eleven structurally required in storage/rendering
(would break older avatars and force recapture). Removing the upgrade path
(older avatars still need it). A skip button on every step (makes skipping the
easy path).

---

## 2026-09-14 — Web Speech lexicon and rule estimator

**Decision.** Web Speech estimation uses a compact frequent-word lexicon followed
by spelling rules that emit supported ARPAbet symbols. Reduced function-word
vowels carry stress digit `0`, and the estimate now appends its 120ms trailing
REST after the final cue instead of reserving that time over the end of speech.

---

## 2026-09-14 — Coarticulated articulation track replaces pose-to-pose commitment

**Decision.** The renderer's target articulation now comes from
`src/core/coarticulation.ts`, not from `articulationAt(timeline)`. Every token is
first normalised to an ARPAbet phoneme plus optional stress (`visemeMapper.ts`;
Azure visemes via `AZURE_VISEME_TO_PHONEME`), then looked up in
`src/core/phonemeArticulation.ts`, where each sound has a target, a visual
strength, per-control dominance, anticipatory/carryover reach and optional
critical controls. The track blends neighbours with a dominance function
(Cohen–Massaro style): weight = strength × control dominance × temporal
falloff, with separate reach before and after each sound, plus per-control reach
multipliers (rounding early, closure fast, jaw slow, tongue brief). Critical
gestures are then enforced as constraints: M/B/P closure + jaw + no rounding,
F/V teeth-on-lip, TH/DH tongue, each for at least 50ms. Diphthongs split into
nucleus and offglide. Short/unstressed vowels shrink toward `SPEECH_NEUTRAL`;
consonants have a 0.85 duration floor. Silences of ≥90ms or at the utterance
edges are barriers that render REST and block influence; shorter inter-word gaps
are weak (0.15). The captured-pose table (`PHONEME_TO_POSE`, `R_POSE`,
`FALLBACK_POSE`) is gone: the debug pose strip derives the nearest pose from each
profile's target. The player's smoothing was lightened (jaw 90→50, lips/tongue
45→30, closure 28→12) because articulator dynamics now live in the target.

**Why.** The old pipeline mapped each sound to one of eleven poses and
committed toward it with symmetric 18ms crossfades and no lookahead. T/D/N/K/G/
NG/H/R all became a full SMALL_OPEN target, S/Z/Y a full EEE smile, every 55ms
inter-word gap dropped the mouth to REST, and upcoming rounding or closure had no
effect until its boundary.

**Details worth keeping.** Unrounded vowels have low rounding dominance (0.35),
so they do not fight an adjacent W or SH for a lip dimension they do not specify.
Bilabials constrain rounding because no captured photograph shows rounded
closure: coarticulated rounding there resolved to a ghosted SH_CH frame (CLOSED
weight 0.65). Barriers exist so the Web Speech start wait and punctuation holds,
which park visual time 1ms before the next word, still show REST.

**Rejected.** An equal three-way average of previous/current/next. Lowering all
smoothing constants as the fix. Strength measured relative to REST (a weak
consonant would then close the mouth between vowels instead of yielding to them).
A new continuous dimension or new captured poses.

---

## 2026-09-14 — Perceptual timing pass after real-face testing

**Context.** On a real face, "Mom moved" and "Hello" lost their vowels, and
"Think about this" looked mistimed. "Too blue", "Kick the ball", "She chose
shoes", F/V and bilabials looked good and were deliberately left alone.
Traces through the estimator, track and a simulated player (visual lead +
60fps smoothing) found the causes before anything was tuned.

**Decisions.**
- *Estimator* (`webspeech.ts`): silent-e stems are resolved before an -d/-s
  inflection ("moved" was `M AA V EH D`, with no /u/ at all); word-final open O
  is OW ("hello", "go" had AA); `move/prove/lose/who/two` added to the lexicon.
  Inside a word, reduced vowels weigh 1.1, full vowels 1.7, diphthongs 2.2 ("about"
  gave its schwa as much time as its stressed /aU/). Words with a full vowel get
  at least 180ms ("go" was 144ms, too short for the jaw to reach OH).
- *Minimum vowel dwell* (`coarticulation.ts`): normal 90ms, stressed 100ms,
  diphthong 130ms, +20ms phrase-final; reduced vowels none. Time is borrowed
  from adjacent consonants (floor 45ms) and, for a phrase-final vowel, up to
  30ms from the pause, so total duration never changes. Gesture size is still
  judged on the provider duration: visible longer, never bigger.
- *Phrase ends*: REST no longer anticipates into speech; a pause after speech
  relaxes to REST over up to 80ms (capped so REST is exact where a punctuation
  hold parks the clock). Previously REST pulled on the last ~30ms of the final
  vowel, on top of the 50ms visual lead.
- *Diphthongs*: nucleus 60% / glide 40%; the glide aims 60% of the way to its
  target (offglides undershoot); diphthongs under 100ms stay one segment aiming
  30% along the glide. OW now targets the OPEN_ROUND capture ("Say OH").
- *Rendering speed of flick gestures*: tongue smoothing 30→12ms (a 77ms TH showed
  its photo for two frames, and the vowel after it looked ~40ms late).
- *Local unblocking*: M/B/P constrain rounding at 60% instead of 100% (full
  suppression made /u/ after M start ~60ms late); F/V width dominance 0.5 (an
  approaching V spread the /u/ of "moved"). Closure, teeth-on-lip, K/G, L and
  SH/CH values are unchanged.

**Rejected.** A global vowel minimum (every vowel = 150ms). Slowing all
animation. Shortening TH globally (traces showed the TH shape was right; the
lag was smoothing and ramping through the L frame). A larger pronunciation
table.

**Known limits.** Web Speech still gives no phoneme timestamps: word durations
come from letter counts and only word starts re-anchor, so a word spoken slower
than estimated reaches REST before its audio ends. A half-closed mouth still
resolves to the TEETH_LIP photo for a frame when lips approach closure, and a
low-jaw /u/ splits between the ROUND and SH_CH photos. Both are photo-blending
limits.

---

## 2026-09-14 — Stressed internal OH and the "fat" /u/ of "moved"

**Context.** On a real face, "No." looked right but the "No-" of "Nolan."
barely moved the lips, and the (now visible) /u/ of "moved" looked flat, fat
and over-pursed. "Too blue.", L and SH/CH looked good.

**Findings (traced before changing anything).**
- "Nolan" was estimated as `N AA L AE N`: no OH existed. Same for "open",
  "over", "nobody", "notebook". Standalone "No" only worked through the
  word-final-O rule. The engine already protected internal diphthongs ("going",
  from the lexicon, showed rounding for 200ms); L was not stealing the vowel.
- Every full /u/ ("Too blue", "moon", "food", "moved") has the same target,
  lipRound 1.0, and lipWidth stays 0.12-0.22 during it -- width was never
  elevated. The difference was pose resolution: in "moved"/"move" the approaching
  V held the vowel almost exactly between the ROUND and SH_CH photographs
  (weights 0.50-0.57) for its whole length, i.e. two pursed-lip photos
  alpha-blended into doubled lip edges; "Too blue" sat at ROUND 0.75-0.82.

**Decisions.**
- *Estimator*: an O in an open first syllable (one consonant, then a vowel) is
  `OW1`; "body" is in the lexicon. Stressed diphthongs weigh 2.6 (unstressed 2.2)
  when a word's duration is shared out, so the stressed OH takes time from the
  rest of the word without lengthening it. Stress is only marked where spelling
  is evidence for it; a blanket "first syllable is stressed" rule was rejected
  because it would shorten the OH of "hello".
- *Nucleus hold* (`coarticulation.ts`): through the core of a full vowel, its
  dominance over the jaw/width/round controls it actually specifies ramps to 2x
  (1x at its edges). Neighbours can no longer park the middle of a vowel
  between two captured shapes; anticipation into the vowel and transitions out
  of it keep their timing. Closure and tongue are never held, and reduced vowels
  are not held, so M/B/P, F/V, L, TH and schwa behave as before.

**Rejected.** Lowering the /u/ target to a "moderate" ~0.85 rounding: with
two-photograph blending that value lies between ROUND and SH_CH, so it would
have put every /u/ -- "Too blue" included -- into the same doubled-lip blend. A
round-suppresses-width constraint: traces showed width was never high during
rounding. Weakening L, or delaying L anticipation: L had little claim on the lips
and was not the cause.
