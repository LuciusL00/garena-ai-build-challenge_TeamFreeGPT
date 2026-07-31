# Adaptive Input Squad Survivor — Implementation Plan v5

**Garena AI Build Challenge — "Reimagine Digital Entertainment Experiences"**

> Self-contained. Anyone reading this — team member, ChatGPT, Codex — has everything needed
> without prior context. v5 rescopes around a three-track team and a solo setup phase.

---

## 0. Status and hard constraints

| Item | Value |
|---|---|
| Plan date | **29 July 2026** |
| Deadline | **9 August 2026** |
| Days remaining | **12, inclusive** |
| Setup phase | **29–31 July, single person**, while shortlist confirmation is pending |
| Full team available from | **1 August** |
| Team | 3 members, varying availability |
| Toolchain | Node 22.20.0, npm 10.9.3, Vite, VS Code, Codex |

**The schedule is the binding constraint, not the ideas.** Everything below is scoped so work
can stop at any tier boundary and still produce a coherent submission.

---

## 1. Product thesis

Mobile games let players move and resize buttons, but the player still adapts to the
touchscreen. Players differ in hand size, motor ability, grip, fatigue, reach and reaction
time. Inputs differ too: touch is fast but hard to reach; a gesture is slower but steadier;
face movement works when both hands are occupied.

The system in one line:

> **Declared action requirements × measured input capabilities → assignment, with an explanation.**

Action requirements are *declared* (Dodge is latency-critical; Ability is not). Input
capabilities are *measured per player* (this player's touch accuracy, this player's gesture
latency). The recommender combines them, explains itself, and the result is validated
before/after.

The novelty is **not gesture recognition** — Project Gameface and Cephable already validate
alternative controls. The contribution is the measurement, the explainable assignment policy,
and the validation.

---

## 2. Locked decisions

Settled. Implement, do not relitigate.

| # | Decision | Why |
|---|---|---|
| D1 | **`ActionBus` + `BindingMap` built in the setup phase**, before there is anything to bind. | Accepting a recommendation must be a one-line runtime map mutation, not a code change. Without this the core demo is impossible. |
| D2 | **`CalibrationScene` is the primary measurement instrument** — a prompted cue-response task. | In-game taps give no ground truth for player *intent*. A cue → response trial does. |
| D3 | **Latency defined identically for every input**: cue onset → activation, ms. | Gesture includes a stability window and will likely be *slower* than touch. That is the real finding. Do not fabricate favourable numbers. |
| D4 | **Auto-fire at nearest enemy.** Joystick controls movement only. | Genre-standard, frees a thumb, removes continuous aiming from the remappable set entirely. |
| D5 | **Hand gesture is input #1.** Face is T4. | `GestureRecognizer` ships canned categories and confidence scores. Proves the pipeline cheapest. |
| D6 | **Face input, if built, uses blendshapes (`jawOpen`), never head yaw/pitch.** | A handheld phone moves with the player's hands, corrupting camera-relative head pose. Blendshapes are face-relative and **substantially less affected** — though still degraded by poor lighting, extreme angles, occlusion and talking. Not immune. |
| D7 | **Only one vision model runs at a time** — whichever channel owns a currently-bound source. | Two MediaPipe models on one stream roughly doubles inference cost and hurts frame rate on mid-range Android. |
| D8 | **Deploy to HTTPS in the setup phase**, before there is a game. | `getUserMedia` needs a secure context; `vite --host` over LAN is HTTP and the camera is silently blocked. Also the submission artifact. |
| D9 | **`ui/layout.ts` returns all HUD positions from `(width, height)` from the first commit.** | Tuning landscape only, but portrait won't break. ~1 h now vs ~1 day retrofitted. |
| D10 | **Roguelike content (XP, upgrade cards, boss) is cut.** | Contributes nothing to the thesis. |
| D11 | **`DODGE` is latency-critical and stays on touch unconditionally.** The recommender refuses to move it and says why. | See §4.1 — this is the evidence that the recommender reasons rather than always preferring the novel input. |
| D12 | **`BindingMap` governs dispatch, not just configuration.** An action emitted by a source reaches listeners only if that source is currently bound to it. | Otherwise touch *and* gesture both fire `ABILITY` after a rebind and the central demo silently fails. |
| D13 | **`InputSourceId` and `InputChannelId` are separate concepts.** | `BindingMap` binds *sources* (`TOUCH_ABILITY`, `HAND_CLOSED_FIST`). `InputChannel` is the lifecycle owner (touch, hand-vision) that D7 starts and stops. One model provides several bindable sources. |
| D14 | **The only adaptation implemented is moving an action to a different input.** Layout findings (bias, hitbox, debounce) are **advisory text only**, never auto-applied. | Auto-applying layout changes is a second system with its own failure modes, and layout advice needs more samples than calibration provides. Displaying the analysis is near-free and still shows the work. |
| D15 | **In-game telemetry is reduced to a single counter**: Ability activations attempted vs succeeded during a round. | Calibration is the primary evidence (§6.4). Full in-game telemetry is a day of plumbing for a secondary number. |
| D16 | **Squad tactics are Follow and Spread only.** Focus is T4. | Focus needs target selection and priority logic — the fiddliest squad work for the least visible payoff. |

---

## 3. Demo ergonomics

A player holding a phone in landscape with both thumbs on screen **cannot make a fist at the
front camera.** The demo is split so each segment resolves this honestly.

**Segment A — direct control (primary, must ship).** Phone propped in a stand or held
one-handed. Ability is the remap candidate, using hand gesture. Carries the
calibration → recommendation → before/after story.

**Segment B — squad control (T1).** One hand on screen, other hand gesturing to toggle tactic.
Justified because squad commands are non-urgent, so briefly losing a thumb costs nothing.

**Segment C — face input (T4).** Both thumbs on screen, `jawOpen` triggers Ability. Strongest
accessibility beat because the hands are genuinely unavailable. Ships only if everything else
is done.

Test condition framing: **one-handed grip / thumb reach on a large phone.** A real,
demonstrable constraint. Never claimed to simulate any disability.

---

## 4. Game format

2D top-down squad survivor, one arena, two rounds.

| Setting | Round length |
|---|---|
| Development / testing | **45–60 s** |
| Demo & video recording | **30 s** |

Short rounds are correct because calibration — not gameplay — is the primary evidence, and a
predictable short demo beats a large volume of noisy telemetry.

- Player character; movement via virtual joystick.
- Auto-fire at nearest enemy in range.
- `ABILITY` — discrete, latency-tolerant. **The remap candidate.**
- `DODGE` — discrete, latency-critical. **Never remapped (D11).**
- Two AI teammates: Follow / Spread.
- One enemy type, constant spawn rate, contact damage on cooldown, player HP bar.
- Round ends on timer or death.

Not building: 3D, FPS, MOBA, commercial-game overlay, multiplayer, procedural maps, inventory,
boss, upgrade cards, XP.

Terminology: **"squad control as a small-scale proof of the broader swarm-control concept."**
Two teammates are never described as a swarm.

### 4.1 What Dodge is, and why it exists

A **dodge/dash** is a short burst of movement on a cooldown, usually with brief invulnerability.
Common in the genre (Soulstone Survivors, Death Must Die, 20 Minutes Till Dawn all have one), so
it does not look bolted on.

But that is not why it is in this plan. **Dodge exists so the recommender has something to refuse.**

**Dodge is never calibrated, never measured, never remapped.** It only needs to exist as an
action carrying `latencyCritical: true`. When the recommender runs it outputs:

> *"Dodge is latency-critical. Gesture input adds ~200 ms. Keeping Dodge on touch."*

That single line is the evidence that the system reasons from requirements rather than simply
preferring whatever input is novel. Ability and Dodge are outwardly identical — both discrete,
both a button — and differ only in declared requirements. That contrast **is** the product.

Cost: a velocity burst for ~150 ms, a cooldown timer, one HUD button. No telemetry, no gesture
work, no calibration.

**Fallback if cut:** have the recommender refuse to remap `MOVE` instead. Free, but weaker —
steering with a fist is obviously implausible, so refusing it is unsurprising.

---

## 5. Architecture

### 5.1 The keystone

Every input emits abstract actions. No entity ever reads a pointer, a landmark or an audio buffer.

```
TouchControls ─┐
GestureInput  ─┼─► ActionBus.emit(action, { source, timestamp, ... })
FaceInput(T4) ─┘
                        │
                        ├──────────────► TelemetryRecorder   (PRE-GATE — records every
                        │                                     emission from every input,
                        │                                     bound or not)
                        ▼
              BindingMap.get(action) === payload.source ?
                        │
                 no ────┴──── yes
                 │             │
                 ▼             ▼
        log as rejected   dispatch to listeners
        (habit data)              │
                                  ▼
                    Player.listen(ABILITY, () => this.useAbility())
```

Two rules that are easy to get wrong:

1. **The gate is on dispatch, never on recording.** Telemetry taps the stream *before* the
   binding check. The unbound input must keep being measured — that is exactly what produces
   the before/after comparison.
2. **Rejected emissions are logged, not discarded.** "The player still reached for the old touch
   button 4 times after rebinding" is real habit-persistence data and a good demo detail.

Accepting a recommendation is then one line, at runtime:

```ts
bindings.set(GameAction.ABILITY, InputSourceId.HAND_CLOSED_FIST);
```

### 5.2 Typed payloads

`MOVE` carries an analogue vector; discrete actions carry confidence. One loose payload type
cannot support both.

```ts
interface ActionPayloadMap {
  [GameAction.MOVE]:         { x: number; y: number };
  [GameAction.ABILITY]:      { confidence?: number };
  [GameAction.DODGE]:        { confidence?: number };
  [GameAction.SQUAD_FOLLOW]: { confidence?: number };
  [GameAction.SQUAD_SPREAD]: { confidence?: number };
}

type Payload<A extends GameAction> =
  ActionPayloadMap[A] & { source: InputSourceId; timestamp: number };

emit  <A extends GameAction>(action: A, payload: Payload<A>): void;
listen<A extends GameAction>(action: A, fn: (p: Payload<A>) => void): void;
```

`MOVE` routes through the bus for consistency but is **non-remappable by policy (D4)**.

### 5.3 Sources vs channels (D13)

```ts
enum InputChannelId { TOUCH, HAND_VISION, FACE_VISION }

enum InputSourceId {
  TOUCH_JOYSTICK, TOUCH_ABILITY, TOUCH_DODGE, TOUCH_TACTIC,
  HAND_CLOSED_FIST, HAND_OPEN_PALM,
  FACE_JAW_OPEN,                    // T4
}
```

`BindingMap: Map<GameAction, InputSourceId>`. A channel starts when any of its sources is bound
and stops when none are — that is D7's one-model-at-a-time rule.

**Initial bindings:**

```text
MOVE          -> TOUCH_JOYSTICK
ABILITY       -> TOUCH_ABILITY
DODGE         -> TOUCH_DODGE
SQUAD_FOLLOW  -> TOUCH_TACTIC
SQUAD_SPREAD  -> TOUCH_TACTIC
```

### 5.4 Scene flow

Four scenes, two reused. No main menu — the start button lives on the first calibration screen.

```text
CalibrationScene (touch)  →  SurvivorScene (round 1)  →  CalibrationScene (gesture)
        →  RecommendationScene (accept / reject)  →  SurvivorScene (round 2)
        →  ResultsScene (before / after)
```

Total run: roughly 5 minutes. That is the demo.

### 5.5 File structure

Directories map one-to-one onto tracks (§9), so no two people edit the same file.

```text
src/
├── config/
│   └── balance.ts             ← every tuning number in one place      [Track 2]
├── input/                                                             [Track 1]
│   ├── GameAction.ts          ← setup phase, types first
│   ├── InputSourceId.ts       ← setup phase, types first
│   ├── ActionBus.ts           ← setup phase, types first
│   ├── BindingMap.ts          ← setup phase, types first
│   ├── InputChannel.ts        ← interface: id, sources[], start(), stop(), isActive
│   ├── TouchControls.ts
│   ├── TouchTelemetry.ts
│   └── GestureInput.ts
├── recommendation/                                                    [Track 1]
│   ├── InputScorer.ts
│   ├── ControlRecommender.ts
│   └── RecommendationTypes.ts ← setup phase, types first
├── data/                                                              [Track 1]
│   ├── SessionTelemetry.ts
│   └── PlayerProfile.ts       ← localStorage-persisted
├── scenes/
│   ├── CalibrationScene.ts    ← the measurement instrument            [Track 1]
│   ├── SurvivorScene.ts                                               [Track 2]
│   ├── RecommendationScene.ts                                         [Track 3]
│   └── ResultsScene.ts                                                [Track 3]
├── entities/  (Player, Teammate, Enemy, Projectile)                    [Track 2]
├── squad/     (SquadController)                                        [Track 2]
├── ui/                                                                 [Track 3]
│   ├── layout.ts              ← D9, all HUD positions derive from (w, h)
│   ├── GameHUD.ts
│   └── RecommendationPanel.ts
└── main.ts
```

### 5.6 Stack

```text
TypeScript (strict: true)
Vite
Phaser 3.90.x            ← not Phaser 4; v3 has far more examples and answers
@mediapipe/tasks-vision
Vercel or Netlify (auto-deploy from main)
```

**No art required.** Phaser `Graphics` draws coloured circles and rectangles; a top-down
survivor made of shapes is perfectly legible on video. Optional: free CC0 sprites from
kenney.nl dropped into `public/` — about two hours, T4.

MediaPipe model files live in `public/` and load via
`FilesetResolver.forVisionTasks("/mediapipe/wasm")` — not Google's CDN. Avoids CDN latency and
blocking, and enables an offline demo. ~8 MB in git is fine.

Vision inference runs on its own timer at **10–15 fps**, decoupled from Phaser's render loop, at
low input resolution.

---

## 6. Measurement methodology

### 6.1 Calibration task

`CalibrationScene` runs a prompted cue-response trial per input:

1. Random delay (1.5–3.5 s), then a cue flashes.
2. The player performs the action on the input under test.
3. Record outcome and timing.

**Adaptive trial count.** A fixed 12 is too fragile: one trial moves the success rate by 8.3
points, so 9/12 (75%) and 10/12 (83%) land on opposite sides of an 80% threshold.

```text
Run 12 trials.
IF the two inputs differ by >= 15 percentage points → stop.
ELSE run 8 more (20 total).
Recorded evaluation sessions always use 20.
```

Report the actual trial count on screen. Describe this as **adaptive stopping, not a controlled
trial** — optional stopping inflates false-positive rates, acceptable for a prototype but not to
be written up as a study.

**Dedicated false-activation window.** After the trials, run a **20–30 s no-cue period** where
the player waits or moves without performing the tested action. Inter-trial gaps are too short
and the player is actively anticipating the next cue.

### 6.2 Metrics

| Metric | Inputs | Definition |
|---|---|---|
| Success rate | all | activations / cues |
| **Latency (median)** | all | **cue onset → activation, ms — identical definition for every input (D3)** |
| False activation rate | all | activations per minute during the dedicated no-cue window |
| Miss distance | touch | px from button centre for failed taps |
| Drift | touch | touchstart → touchend displacement |
| Directional bias | touch | mean offset vector across all taps |
| Repeat-tap rate | touch | % of taps <150 ms after the previous |
| Stability time | vision | ms held above threshold before trigger |
| Confidence (median) | vision | model score at trigger |
| **In-game Ability success** | all | **the single in-game counter (D15): attempted vs succeeded** |

Persisted to `PlayerProfile` in localStorage. JSON export button (T4).

### 6.3 Recommender rules

Transparent, no trained model.

```text
── IMPLEMENTED: input remapping (D14) ──

IF action.latencyCritical                              (D11 — this is DODGE)
    → keep on touch, always. Explain why.

IF touch.successRate < 0.80
   AND alt.successRate > touch.successRate + 0.10
   AND alt.falseActivationRate <= 1.0 per minute
    → recommend moving the action to alt

IF alt.falseActivationRate > 1.0 per minute
    → never recommend alt, regardless of accuracy

── ADVISORY TEXT ONLY, never auto-applied (D14) ──

IF mean tap offset > 25% of button radius
   AND >= 60% of taps fall on the same side of centre
    → display: "your taps land consistently <direction> of centre"

IF >= 20% of failed taps land within 1.5x button radius
    → display: "a larger hitbox would have captured N of your misses"

IF repeat-tap rate > 15%
    → display: "frequent double-taps detected; a longer debounce may help"
```

Bias is a **proportion of button radius**, not a fixed pixel count, so it scales across devices
and button sizes. (At a 48 px radius this equals 12 px.)

Every recommendation carries a plain-language explanation and **Accept / Reject**. Changes apply
**between rounds only**, never mid-combat.

### 6.4 Before/after validation

The headline comparison is the **calibration re-run**, not round score. Cue-response has minimal
learning effect; round 2 of the game is confounded by practice. At 45–60 s rounds the player also
only triggers Ability ~8–12 times, too few to compare reliably.

- **Primary:** calibration metrics, touch vs gesture, identical task.
- **Secondary:** the single in-game Ability counter (D15), round 1 vs round 2, with the learning
  effect stated out loud.

Stating the confound pre-empts the most obvious challenge and costs one sentence.

---

## 7. Ship ladder

Each tier is independently demoable. Work stops wherever the schedule actually lands.

### T0 — Thesis core · **cannot be cut**
Without all of this there is no submission.

- Arena, joystick, auto-fire, one enemy type, HP, score, two rounds
- `ActionBus` + `BindingMap` with dispatch gating (D12) and pre-gate telemetry
- `CalibrationScene`: cue-response, adaptive trials, no-cue window — touch **and** gesture on an identical task
- MediaPipe closed fist → Ability
- Recommender with plain-language explanation
- **Accept → live rebind → visibly works in round 2**
- Before/after screen
- Live HUD: detected input, confidence, mapped action, latency
- Deployed HTTPS URL

### T1 — Proposal coverage
Two teammates, Follow + Spread toggle, tactic shown on HUD. **Higher priority than everything
below**, because cutting squad entirely removes half the submitted proposal — a worse look than
cutting the LLM. ~1 day.

### T2 — Distinctiveness
The Dodge refusal beat (§4.1). Highest value-per-hour on the whole list.

### T3 — AI legibility
LLM tactical-preset mapper. A text box converting one natural-language instruction into one of
two constrained presets. Off the critical path — a serverless function, a fetch, an allowlist
check. ~half a day.

```json
{ "preset": "SPREAD", "spacing": "wide", "priority": "survival" }
```

The API key lives in the serverless function, never in browser code. The response is validated
against an allowlist server-side before it reaches the game. The model selects from approved
values; it never writes gameplay code, never enters the real-time loop, never generates action
sequences.

This matters because the submitted proposal prominently featured natural-language tactical
presets, and because it is the most legible AI feature to a non-technical judge — MediaPipe can
be read as "an imported library," whereas this is unmistakably built.

### T4 — Polish
Advisory layout text · JSON export · second hand gesture (open palm) · face blendshape input ·
Focus tactic · sprite art.

### Cut entirely
XP, upgrade cards, boss, extra teammates, sound input, head pose, custom-trained gestures,
auto-applied layout changes, main menu scene, full in-game telemetry, multiplayer, procedural
maps, inventory, Capacitor/APK.

**Sound is cut.** Pitch thresholding is not itself an ML feature — a weak look in an AI
challenge — and game audio interferes with mic input. Its conceptual role (*fast but socially
constrained*) appears in the roadmap as a designed input, with the `InputChannel` interface as
evidence of extensibility.

---

## 8. Schedule

### Setup phase — 29–31 July, single person

Runs while shortlist confirmation is pending. Deliberately contains no game logic, so nothing
here is wasted and nothing blocks on team availability.

| Item | Detail |
|---|---|
| Scaffold | Vite + TypeScript + Phaser 3.90.x, `strict: true`, Prettier, `.gitignore` |
| Repository | `git init`, GitHub remote, first push |
| **HTTPS deploy** | Vercel auto-deploy from `main`; URL verified on the target Android phone (D8) |
| Types-only merge | `GameAction`, `InputSourceId`, `ActionBus`, `BindingMap`, `InputChannel`, `RecommendationTypes` — interfaces with empty bodies |
| Binding-gate test | Passing (§10) |
| Foundations | `ui/layout.ts`, `config/balance.ts` |
| Stretch | Virtual joystick moving a circle on the deployed URL |

Merging the types first is what lets all three tracks start in parallel on 1 August without
waiting on each other's implementations.

### Build phase — 1–9 August, three tracks

| Date | Track 1 — Input & Measurement | Track 2 — Gameplay | Track 3 — Interface & Delivery |
|---|---|---|---|
| Aug 1–2 | `CalibrationScene` cue-response loop, adaptive trials, no-cue window, `TouchTelemetry`, `InputScorer`, `PlayerProfile` | Arena, joystick, auto-fire, enemy, contact damage, HP bar, score, round timer. All input via `ActionBus` | `ui/layout.ts` build-out, `GameHUD`, scene flow wiring, device test matrix started |
| Aug 3–4 | **MediaPipe closed fist → Ability.** Camera permission + denial path. Gesture calibration on the identical task | **T1:** two teammates, Follow + Spread, tactic action | `RecommendationPanel`, `RecommendationScene`, `ResultsScene` shells |
| Aug 5–6 | `ControlRecommender` rules, explanation text, Accept/Reject, live rebind, before/after aggregation | **T2:** Dodge. Balance tuning from playtest feedback | UI copy for every player-facing string. Demo script written and timed. **T3** if clear |
| **Aug 7** | **Integration day — all tracks.** Wire the halves end to end; fix what only appears when they meet. Play the full 5-minute flow repeatedly and log every break. **← T0 + T1 + T2 complete** | | |
| Aug 8 | **Code freeze at noon.** Final device testing | Freeze at noon | **Record demo video** (multiple takes). Draft submission writeup |
| Aug 9 | Standby for blocking bugs only | Standby | Final checks, submit. **No code** |

**Integration day is not optional.** Three tracks building in parallel for a week will have
integration problems, and there must be a day budgeted for them.

**If behind on 5 August:** cut T2 (Dodge), reduce the tactic toggle to a single Spread button,
cut T3 entirely, and protect the integration day. A complete honest T0 beats a broken ambitious
build.

---

## 9. Tracks and ownership

Availability varies across the team. The ship ladder (§7) exists so that reduced capacity changes
**which tier is reached**, not whether there is a submission.

Directories map one-to-one onto tracks (§5.5), so no two people edit the same file.

### Track 1 — Input & Measurement
**Owns:** `input/`, `recommendation/`, `data/`, `CalibrationScene.ts`

The critical path: calibration → gesture → recommender → before/after. Serial, and the one part
that cannot be parallelised. Algorithmic and testable, and **requires no game-development
experience** — which makes it the right assignment for the strongest general coder regardless of
whether they have built a game before.

**Single ownership.** This is the highest-risk merge surface in the project; concurrent editing
here costs more than it saves.

### Track 2 — Gameplay
**Owns:** `entities/`, `squad/`, `SurvivorScene.ts`, `config/balance.ts`

Player, enemies, projectiles, teammates, the arena, and every tuning number. Game bugs are
*visible*, which makes this the most forgiving track to build with an agent and to review by
reading rather than authoring.

Also owns **balance tuning** — collecting playtest feedback and adjusting `config/balance.ts`
until the game feels right. Nothing else on the schedule will make time for this, and an untuned
game feels bad on video.

### Track 3 — Interface & Delivery
**Owns:** `ui/`, `RecommendationScene.ts`, `ResultsScene.ts`, deployment, device testing, UI copy,
**demo video and submission writeup**

Self-contained UI components with clear specs (the HUD panel: given
`{detected, confidence, action, latency, tactic}`, render five lines at positions from
`layout.ts`) plus everything that turns a working build into a submission.

**Delivery is not overhead.** A working prototype nobody sees loses to a smaller prototype
presented well. The video and writeup are roughly two days of real work and should sit with the
most consistently available member.

### Working rules
- Feature branches, PRs **merged same day**. A three-day branch is a merge conflict with interest.
- **Never two people in one file.** Tracks own disjoint directories by design.
- Types with empty implementations merge first, so tracks never block on each other.
- 10-minute daily sync: what merged / what is blocked / what merges tomorrow.
- Do not add scope because a tier finished early. Move to the next tier, or stop.

---

## 10. Acceptance criteria

### Setup phase — end of 31 July
1. `npm run build` passes, `strict: true`, zero errors.
2. Phaser boots a scene, `Scale.FIT`, responsive to viewport.
3. Deployed; the HTTPS URL opens correctly on the target Android phone.
4. `ui/layout.ts` exports `(width, height) => positions`. `config/balance.ts` exists.
5. **Binding-gate test passes.** With `ABILITY -> TOUCH_ABILITY`, a `TOUCH_ABILITY` emission
   reaches listeners and `HAND_CLOSED_FIST` does not. After
   `bindings.set(ABILITY, HAND_CLOSED_FIST)`, the reverse holds. **In both configurations, both
   emissions appear in telemetry.**

### Playable game — end of 2 August
1. Loads from the deployed URL on a real phone, landscape, no console errors.
2. Joystick moves the player; movement uses `delta` (frame-rate independent).
3. Auto-fire at nearest enemy; projectiles despawn off-screen or on hit, no leaks.
4. Enemies spawn on a timer, move toward the player, deal contact damage on cooldown.
5. HP bar; reaching 0 ends the round. Score visible.
6. Round runs its configured duration and exits cleanly.
7. Ability and Dodge fire and respect cooldowns.
8. **`Player` responds only to `ActionBus` events — zero pointer/touch API references in `entities/`.**
9. **All HUD positions derive from `ui/layout.ts`.** All tuning numbers live in `config/balance.ts`.
10. ≥45 fps on the target Android with ~20 enemies and ~30 projectiles.

> Criteria 8–9 are the ones that get skipped under time pressure. Every later tier depends on
> them; retrofitting them during integration week is what loses the deadline.

### T0 complete — end of 7 August
1. The full 5-minute flow runs end to end without a reload.
2. Calibration produces per-input metrics for touch and gesture on an identical task, with
   adaptive trial count and a dedicated no-cue window.
3. Recommender emits a recommendation with a plain-language explanation.
4. **Accept rebinds at runtime and the gesture visibly works in round 2.**
5. Reject leaves bindings unchanged.
6. Before/after screen shows calibration deltas plus the in-game Ability counter, with the
   confound noted.
7. HUD shows detected input, confidence, mapped action, latency.
8. Camera denial leaves the game fully playable on touch.

### T1 / T2 complete
9. Two teammates follow and auto-attack; the tactic toggle visibly changes their formation.
10. Recommender **declines** to move Dodge and states why.

---

## 11. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Rebinding requires code changes → demo impossible | **Critical** | D1 + D12 in the setup phase, with a passing gate test |
| No ground truth for "accuracy" | **Critical** | D2 prompted cue-response calibration |
| Tracks do not integrate | **High** | 7 Aug is a dedicated integration day, not a feature day |
| Binding gate blocks telemetry → no before/after data | **High** | §5.1 gate on dispatch only; record pre-gate |
| HTTPS not ready → camera blocked on phone | **High** | D8 deploy in the setup phase, before there is a game |
| MediaPipe + Phaser tank frame rate | **High** | D7 one model at a time; 10–15 fps inference; low input resolution |
| Uneven availability across the team | **High** | Ship ladder — every tier boundary is a valid stopping point |
| One trial flips the recommendation | Medium | §6.1 adaptive trial count |
| Gesture latency worse than touch, numbers look bad | Medium | D3 — it *will* be. Report honestly; it is the tradeoff the recommender exists for |
| Before/after confounded by practice | Medium | §6.4 calibration is the headline metric |
| Untuned game feels bad on video | Medium | Track 2 owns balance; `config/balance.ts` makes tuning a one-file change |
| iOS Safari: no fullscreen, no orientation lock | Low | D9 target Android Chrome; portrait survives untuned |

---

## 12. Honesty and framing constraints

Non-negotiable, applying to the code, the video and the writeup.

- One human input maps to one approved game action. No macros, no action sequences.
- No aim assistance. No reading live game state for real-time input decisions.
- Recognition runs **on-device**. Raw camera data never leaves the device.
- Binding changes require explicit user approval, between rounds only.
- **Never claim that simulated input noise proves accessibility effectiveness for real disabilities.**
- Use real traces. Describe scripted traces only as engineering stress tests.
- Describe the calibration as **adaptive stopping, not a controlled trial.**
- Framed as **publisher-integrated middleware**, not an unauthorised overlay.
- Never say "swarm" for two teammates.
- **Anything not shipped is presented as designed-not-shipped, with the schema or interface as
  evidence.** Face input, sound, and the LLM all fall under this if they miss. Explicit
  prioritisation reads as judgment; silence reads as abandonment.

### Where the "AI" credit is
The recommender is deliberately rule-based and explainable — the correct engineering call, since
the product must justify its recommendations. The AI content is:
1. **On-device ML gesture recognition** (MediaPipe) — lead with this.
2. **LLM interpretation of natural-language tactical instructions**, constrained to a validated
   schema (T3).

---

## 13. Instructions for Codex

For every task:
1. Inspect the repository first.
2. Explain the planned change before making it.
3. Modify only the necessary files.
4. Keep code modular and strictly typed.
5. Run the build and fix all TypeScript errors.
6. Do not add libraries without explaining why.
7. Do not redesign unrelated working features.
8. Summarise all changed files.
9. **Stop after the requested tier. Do not implement future tiers early.**

### Setup-phase request

```text
Scaffold a mobile-friendly Phaser 3 game in TypeScript with Vite.

Deliver ONLY:

1. Vite + TypeScript + Phaser 3.90.x, tsconfig strict: true
2. .gitignore, Prettier config
3. Phaser booting into an empty scene, Scale.FIT, responsive to viewport
4. src/ui/layout.ts       exporting (width, height) => HUD anchor positions
5. src/config/balance.ts  exporting all tuning constants (empty stub is fine)
6. Types with minimal implementations:
   - src/input/GameAction.ts     enum: MOVE, ABILITY, DODGE, SQUAD_FOLLOW, SQUAD_SPREAD
   - src/input/InputSourceId.ts  enum: TOUCH_JOYSTICK, TOUCH_ABILITY, TOUCH_DODGE,
                                 TOUCH_TACTIC, HAND_CLOSED_FIST, HAND_OPEN_PALM
   - src/input/InputChannel.ts   interface: id, sources[], start(), stop(), isActive
   - src/input/ActionBus.ts
   - src/input/BindingMap.ts
   - src/recommendation/RecommendationTypes.ts

ARCHITECTURE REQUIREMENTS — these are the point of this task:

a) BindingMap governs dispatch, not just configuration. An action emitted by a source
   reaches listeners ONLY IF that source is currently bound to that action.

b) Telemetry hooks are placed BEFORE the binding check, so emissions from unbound
   sources are still recorded. Rejected emissions must be recorded, not discarded.
   (Leave the recorder itself as a stub that logs to console.)

c) ActionBus payloads are strongly typed per action via a mapped type:
     MOVE             -> { x: number; y: number }
     discrete actions -> { confidence?: number }
   All payloads additionally carry { source: InputSourceId; timestamp: number }.

d) InputSourceId (bindable signal) and InputChannelId (lifecycle owner: TOUCH,
   HAND_VISION, FACE_VISION) are separate concepts. A channel owns several sources.

e) Initial bindings:
     MOVE -> TOUCH_JOYSTICK, ABILITY -> TOUCH_ABILITY,
     DODGE -> TOUCH_DODGE, SQUAD_FOLLOW and SQUAD_SPREAD -> TOUCH_TACTIC

f) Include a small non-game test (unit test or console script) proving:
     - with ABILITY -> TOUCH_ABILITY: a TOUCH_ABILITY emission is dispatched,
       a HAND_CLOSED_FIST emission is NOT
     - after bindings.set(ABILITY, HAND_CLOSED_FIST): the reverse holds
     - in BOTH configurations, BOTH emissions appear in telemetry

Do NOT add: MediaPipe, gameplay logic, enemies, squad AI, scenes beyond the empty
boot scene, art assets, or any LLM integration.
Confirm `npm run build` passes with zero errors.
```

---

## 14. Open questions

Resolved in earlier versions: trial count (adaptive 12→20), bias threshold (25% of button radius
+ 60% same-side), false-activation measurement (dedicated no-cue window), round length (45–60 s /
30 s demo), scope prioritisation (ship ladder), track allocation (§9).

Still open:

1. **Cue modality.** The calibration cue is currently a visual flash. Should it be audio, or both?
   A visual cue competes for the attention the gesture input also needs, which may inflate gesture
   latency relative to touch — a confound in the direction that flatters touch.
2. **What the video leads with.** The recommendation moment (accept → rebind → it works) or the
   refusal moment (Dodge stays on touch, and here is why)? The refusal is the more distinctive
   claim but needs more setup to land in a short video.
3. **Advisory-vs-implemented framing.** D14 ships layout findings as text only. Is there a
   one-line framing that makes this read as appropriate caution rather than an unfinished feature?
4. **Habit-persistence metric.** Rejected-emission counts ("the player reached for the old button
   N times after rebinding") is a genuinely novel small metric. Worth surfacing in the demo, or a
   distraction from the main comparison?
