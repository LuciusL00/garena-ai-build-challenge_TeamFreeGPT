# Adaptive Input Layer — Implementation Plan v8

**Garena AI Build Challenge 2026**

> The specification. For current progress, milestones and work split see [STATUS.md](STATUS.md).
> v8 keeps T0 on one discrete touch-button ↔ closed-fist mapping. Swarmfall now exposes native
> directional squad control as a later mapping seam; pointing and directional calibration are T1.

---

## 0. Constraints

| Item | Value |
|---|---|
| Plan date | 30 July 2026; revised 3 August 2026 |
| Submission | **9 August 2026** — deck, source code, video |
| Finalists announced | 13 August · Final presentations 23 August |
| Team | 3 members, full team from 1 August |
| Toolchain | Node 22, Vite, TypeScript, MediaPipe |

### Judging weights

| Criterion | Weight | What it rewards |
|---|---|---|
| **Problem–Solution Fit** | **40%** | Clarity of problem, user understanding, strength of solution, suitability of AI, **prioritisation of trade-offs** |
| Build Quality | 30% | Functions end-to-end **in a live setting**, reliability, **genuine use of AI-driven behaviour**, soundness of integration |
| Originality | 30% | Originality of insight, differentiation from existing products, uniqueness of execution |

Two consequences. First, the largest criterion is judged mostly on the deck, not the code — the
decision log in §2 is deck material, not internal scaffolding. Second, AI must do real work.
On-device MediaPipe gesture recognition is the shipped AI component; an LLM is not required for
T0 and is deferred until the mapping pipeline works end to end.

### Technology guidelines

The brief prescribes **no technology restrictions**. MediaPipe, any LLM, any framework are
permitted. Disclosure of third-party libraries, models, datasets and APIs is **mandatory** —
see [DISCLOSURE.md](DISCLOSURE.md).

---

## 1. Product thesis

Mobile games let players move and resize buttons, but the player still adapts to the
touchscreen. Players differ in hand size, motor ability, grip, fatigue, reach and reaction time.
Input channels differ too: touch is fast but hard to reach; a gesture is slower but steadier;
face movement works when both hands are occupied.

The layer does two things, and both matter to the pitch.

**It provides the input channels.** Touch controls and on-device hand gesture recognition,
behind one uniform interface. A game adopting the layer gets alternative controls without
building a camera pipeline, integrating a model, or writing per-channel plumbing. This is the
half that makes it adoptable: a studio that only received *advice* would still have to build
every channel itself.

The same `InputChannel` interface is designed to accept further channels — face blendshapes,
device tilt, sound. **Those are described as designed, not delivered, until one of them actually
runs.** Claim discipline matters here: it is far better to ship two channels and an interface
that visibly accommodates more than to imply capabilities the demo does not have.

**It assigns those channels to actions, per player.**

> **Declared action requirements × measured input capabilities → assignment, with an explanation.**

Games *declare* what their actions need. The layer *measures* what this particular player can
do. The recommender matches the two, explains itself, and the result is validated before/after.

**The product is the layer, not the game.** It knows nothing about any particular title. Swarmfall
is one host; a structurally different game should be able to adopt it without the layer changing.

Providing alternative input is not itself novel — Project Gameface and Cephable already do it.
What none of them do is measure *this* player on *each* channel and assign actions accordingly.
The contribution is the combination: channels supplied as infrastructure, plus per-player
measurement, an explainable assignment policy, and validation that the change actually helped.

Because the layer owns every channel, it can also *enforce* parity between them (D16) — something
no bolt-on overlay is in a position to guarantee.

### Integration surface

What a developer writes to adopt the layer:

```ts
// The layer supplies these — the game builds no input code of its own.
adaptive.enableChannels(['TOUCH', 'HAND_VISION']);

adaptive.registerActions([
  { id: 'ACTIVATE_STRATEGY', requirements: { spatial: false, latencyCritical: false } },
  { id: 'BEGIN_ROUND',       requirements: { spatial: false, latencyCritical: false } },
  { id: 'RESTART_ROUND',     requirements: { spatial: false, latencyCritical: false } },
]);

adaptive.on('ACTIVATE_STRATEGY', () => game.activateSelectedStrategy());
```

The game never touches a pointer event, a hand landmark or a camera stream. This snippet is a
deck slide.

---

## 2. Locked decisions

| # | Decision | Why |
|---|---|---|
| D1 | **`ActionBus` + `BindingMap` are built before anything binds to them.** | Accepting a recommendation must be a one-line runtime map mutation, not a code change. Without this the core demo is impossible. |
| D2 | **Measurement is a prompted cue-response task**, not in-game input. | A missed tap is indistinguishable from no tap. A cue gives ground truth for player *intent*. |
| D3 | **Latency is defined identically for every channel**: cue onset → activation, ms. | Vision channels include a stability window and will measure *slower* than touch. That is the real result. Do not fabricate favourable numbers. |
| D4 | **`BindingMap` governs dispatch, not just configuration.** | Otherwise touch *and* gesture both fire after a rebind, and the demo silently fails. |
| D5 | **Telemetry taps the stream pre-gate.** Rejected emissions are recorded, not discarded. | The unbound channel must keep being measured — that is what produces the before/after. Rejected emissions are also habit-persistence data. |
| D6 | **`InputSourceId` and `InputChannelId` are separate concepts.** | Bindings bind *sources* (`HAND_CLOSED_FIST`). Channels (`HAND_VISION`) own lifecycle. One model provides several sources. |
| D7 | **Only one vision model runs at a time** — whichever channel owns a bound source. | Two MediaPipe models on one stream roughly doubles inference cost and hurts frame rate on mid-range Android. |
| D8 | **The recommender warns; it never blocks.** Actions whose requirements are poorly served by a channel produce a warning with a **quantified cost**, and the player may override it. | Refusing to let a player remap their own controls is paternalistic, and paternalism is the wrong posture for an accessibility product — the premise is that the player knows their own needs. Quantifying the measured success, latency and false-activation difference still leaves the decision where it belongs. |
| D9 | **The layer never imports from `demos/`.** | The one-way dependency is what makes the portability claim verifiable rather than asserted. |
| D10 | **Hand gesture is channel #1.** Face and tilt are T3. | `GestureRecognizer` ships canned categories and confidence scores. Proves the pipeline cheapest. |
| D11 | **Face input, if built, uses blendshapes (`jawOpen`), never head pose.** | A handheld phone moves with the player's hands, corrupting camera-relative head pose. Blendshapes are face-relative and substantially less affected — though still degraded by poor lighting, occlusion and talking. Not immune. |
| D12 | **Deploy to HTTPS before building features.** | `getUserMedia` needs a secure context; LAN access over plain HTTP silently blocks the camera. Also the submission artifact. |
| D13 | **Natural-language mapping is deferred.** If added later, a model may select only allowlisted input-to-action mappings and never gameplay behaviour. | T0 must prove adaptation without a decorative LLM, generated strategy, macros or executable output. |
| D14 | **The recommender is a transparent rule set, not a trained model.** | It must justify itself to the player before changing their controls. Explainability is the feature, not a limitation. |
| D15 | **Only one adaptation is implemented: moving an existing action to a different input source.** Button placement, size, offset and drift adaptation are out of scope. | UI layout requires game-specific code and weakens the middleware boundary. |
| D16 | **Channels may differ in speed and reliability. They must never differ in capability.** | Every command reachable by gesture must also be reachable by touch. Otherwise the alternative channel is a power-up, the accessibility framing collapses, and a judge correctly calls it a cheat. |

---

## 3. Demo host: Swarmfall

Swarmfall is a real-time swarm control game: the player selects a squad and presses and drags
like a virtual joystick to move that squad's activity centre. Units coordinate around that
centre, harvesters extract and bank ore, and guards intercept threats. Releasing stops the
directional command. Switching squads while a direction is active transfers the direction to
the new squad and stops commanding the previous one. Rounds last sixty seconds.

**Why it fits the thesis better than a conventional action game:**

- Units retain local autonomous behaviour, so the player steers squads rather than individual
  workers. This keeps the game action boundary small and deterministic.
- The native pointer joystick and future hand-point direction both produce the same relative
  `{x, y}` information. Vision therefore changes the input channel, not the game's capabilities.
- T0 deliberately calibrates one discrete touch/fist command first. Continuous pointing is kept
  out of the critical path until recommendation and live rebinding work end to end.

### Actions

The current repository Swarmfall is Lucius's temporary integration host while Mark is unavailable.
Mark's canonical demo and final action table are still pending. T0 needs one existing zero-payload
discrete command; it does not depend on pointing or new strategy generation.

| Action | Payload / requirements | Role | Status |
|---|---|---|---|
| `MOVE_SQUAD_DIRECTION` | `{ direction: { x, y } }`; continuous | Native pointer joystick; T1 seam for hand-point direction | implemented locally in Lucius's fallback host |
| `STOP_SQUAD_MOVEMENT` | `{}`; direction-ended command | Pointer release/cancel; prevents stuck movement | implemented locally in Lucius's fallback host |
| `SELECT_SQUAD` | `{ squad }`; discrete | Fixed touch selection; transfers an active direction | implemented locally in Lucius's fallback host |
| `ACTIVATE_STRATEGY` | `{}`; discrete, non-urgent | Temporary T0 remap candidate until Mark supplies the canonical action list | exists in Lucius's fallback host |
| Begin / restart | `{}`; discrete | Fixed original touch controls, excluded from recommendations | exists in Lucius's fallback host |

Mark must publish the canonical action contract before final integration. The layer emits only a
registered action and typed payload; the game adapter decides how that action affects workers.
Per-worker movement commands, target selection and timed command sequences never belong in the
middleware.

### Ergonomics

A player holding a phone with both thumbs cannot make a fist at the front camera. Two honest
configurations:

- **Phone propped or held one-handed**, other hand gesturing. Carries the
  calibration → recommendation → before/after story.
- **Both thumbs on screen**, face blendshape triggers a command (T3). The strongest accessibility
  beat, because the hands are genuinely unavailable.

Test framing: **one-handed grip and thumb reach on a large phone.** A real, demonstrable
constraint. Never claimed to simulate any disability.

---

## 4. Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the reviewer-facing version. Design notes here.

### 4.1 Data flow

```text
TouchInput ───┐
GestureInput ─┴─► InputSignal (trigger, point, or direction + metadata)
                         │
                         ▼
              host adapter supplies action + typed payload
                         │
                         ├────────► TelemetryRecorder (PRE-GATE, D5)
                         ▼
              BindingMap.get(action) === signal.source ?      (D4)
                         │
                  no ────┴──── yes
                  │             │
                  ▼             ▼
         log as rejected   dispatch to host listener
```

Accepting a recommendation is one line, at runtime:

```ts
adaptive.rebind('TOGGLE_SQUAD', InputSourceId.HAND_CLOSED_FIST);
```

### 4.2 Typed payloads

Host actions retain their own typed payloads. Trigger, absolute-point and relative-direction
input signals use a separate game-independent union.

```ts
emit<A extends GameAction>(
  action: A,
  payload: ActionPayloadMap[A],
  signal: InputSignal,
): boolean;

listen<A extends GameAction>(
  action: A,
  fn: (payload: ActionPayloadMap[A]) => void,
): void;
```

### 4.3 Repository layout

```text
packages/
└── adaptive-input/          the product
    ├── input/
    │   ├── ActionBus.ts     ─┐
    │   ├── BindingMap.ts     ├─ spine                          [core]
    │   ├── InputChannel.ts  ─┘  (merged first, unblocks all)
    │   ├── TouchControls.ts    channel                         [touch]
    │   ├── WebTouchInput.ts    web channel                     [core/touch]
    │   └── GestureInput.ts     channel                         [vision]
    ├── calibration/         cue-response harness               [core]
    ├── recommendation/
    │   ├── InputScorer.ts       samples → per-channel numbers  [core]
    │   └── ControlRecommender.ts  rules + explanations         [core]
    └── data/                SessionTelemetry, PlayerProfile    [core]

demos/
└── swarmfall/               the demo                           [core]
```

`packages/adaptive-input/` must never import from `demos/` (D9).

### 4.4 Stack

```text
TypeScript (strict) · Vite · @mediapipe/tasks-vision
Vercel or Netlify, auto-deploy from main
```

MediaPipe model files live in `public/` and load via
`FilesetResolver.forVisionTasks("/mediapipe/wasm")` rather than Google's CDN — avoids CDN latency
and blocking, and enables an offline demo. Vision inference runs on its own timer at **10–15 fps**,
decoupled from the render loop, at low input resolution.

---

## 5. Measurement

### 5.1 Calibration task

A prompted cue-response trial per channel:

1. Random delay 1.5–3.5 s, then a cue appears.
2. The player responds on the channel under test.
3. Outcome and timing recorded.

**Adaptive trial count.** A fixed 12 is too fragile — one trial moves the success rate by 8.3
points, so 9/12 (75%) and 10/12 (83%) straddle an 80% threshold.

```text
Run 12 trials.
IF the two channels differ by >= 15 percentage points → stop.
ELSE run 8 more (20 total).
Recorded evaluation sessions always use 20.
```

Report the actual trial count on screen. Describe as **adaptive stopping, not a controlled
trial** — optional stopping inflates false-positive rates, acceptable for a prototype but not to
be written up as a study.

**Dedicated false-activation window.** After the trials, a **20–30 s no-cue period** where the
player waits without performing the tested action. Inter-trial gaps are too short and the player
is anticipating the next cue.

### 5.2 Metrics

| Metric | Channels | Definition |
|---|---|---|
| Success rate | all | activations / cues |
| **Latency (median)** | all | **cue onset → activation, ms — identical for every channel (D3)** |
| False activation rate | all | activations per minute during the no-cue window |

Persisted to `PlayerProfile` in localStorage.

### 5.3 Recommender rules

```text
── IMPLEMENTED: channel remapping ──

IF action.spatial OR action.latencyCritical                    (D8)
    → do not recommend moving it.
      If the player chooses to move it anyway, show a warning quantifying
      the measured cost from calibration, and allow the override.
      e.g. "Touch succeeded 91% of the time; gesture succeeded 64%.
            Reliability may drop. Move it anyway?"

IF touch.successRate < 0.80
   AND alt.successRate > touch.successRate + 0.10
   AND alt.falseActivationRate <= 1.0 per minute
    → recommend moving the action to alt

IF alt.falseActivationRate > 1.0 per minute
    → never recommend alt, regardless of accuracy

```

Every recommendation carries a plain-language explanation and **Accept / Reject**. Changes apply
**between rounds only**, never mid-play.

### 5.4 Before/after validation

The headline comparison is the **calibration re-run**, not round score — cue-response has minimal
learning effect, whereas a second round of play is confounded by practice.

- **Primary:** calibration metrics, touch vs gesture, identical task.
- **Secondary:** in-game command success, round 1 vs round 2, with the learning effect stated.

Stating the confound pre-empts the most obvious challenge and costs one sentence.

---

## 6. AI components

| Component | Role | Runs |
|---|---|---|
| MediaPipe Tasks Vision | On-device gesture recognition | In-browser, on-device |

MediaPipe is the shipped AI behaviour: it turns camera frames into on-device gesture categories
and confidence values. The transparent recommender then uses measured player results. A future
model may interpret natural language into an allowlisted mapping ID, but it is not part of T0,
does not generate strategy, and does not enter the real-time loop.

---

## 7. Ship ladder

Each tier is independently demoable. Work stops wherever the schedule lands.

### T0 — Core · cannot be cut
- Swarmfall integrated through typed game actions; one existing discrete command is registered
  with the adaptive layer while the native directional control remains available
- `BindingMap` with dispatch gating (D4) and pre-gate telemetry (D5)
- Calibration: cue-response, adaptive trials, no-cue window — touch **and** gesture, identical task
- MediaPipe gesture → one discrete command
- Recommender with a plain-language, quantified comparison of the two measured channels
- **Accept → live rebind → visibly works in round 2**
- Before/after screen
- Live HUD: detected input, confidence, mapped action, latency
- Deployed HTTPS URL

### T1 — Mapping polish
Map hand-point direction to the same `MOVE_SQUAD_DIRECTION` action used by the native pointer
joystick. Add an equivalent direction-ended signal, four-direction prompted calibration with
automatic angular-error measurement, additional allowlisted mappings, clearer explanations and
stronger mobile validation. A natural-language selector is considered only after T0 is reliable
and is not required to ship.

### T2 — Portability proof
Second demo host, if time permits, would provide the portability proof. It turns the middleware
claim from asserted to demonstrated and pre-empts the obvious judge objection:
*"you built one game with custom controls and called it a platform."* ~1.5 days, conditional on
Swarmfall integration going smoothly.

### T3 — Polish
Second gesture · face blendshape channel · tilt channel · JSON export · sprite art.

### Cut
Custom-trained gestures · sound input (pitch thresholding is not itself an ML feature, and game
audio interferes with mic input) · head pose · button-layout adaptation · generated strategy ·
multiplayer · procedural content.

Anything cut is presented in the deck as **designed, not shipped**, with the schema or interface
as evidence. Explicit prioritisation reads as judgment; silence reads as abandonment. The brief
explicitly rewards "prioritisation of trade-offs."

---

## 8. Schedule

| Date | **Lucius — Core & Touch** | **Vivin — Vision** | **Mark — Demo Host** |
|---|---|---|---|
| **1 Aug** | Create the portable types, binding gate and telemetry skeleton | Prototype camera, closed-fist and point-direction recognition | Confirm that the canonical demo can be exported and extended |
| 2–3 Aug | Review the skeleton; add the temporary directional-control host; define the T0 touch path | Provide source, model/dependency details and current calibration behaviour | Export the canonical demo and publish its action/payload table |
| 4–5 Aug | Touch channel, identical cue-response calibration, `InputScorer`, recommender, Accept/Reject and **live rebind** | Port recognition behind `InputChannel`; add stability, fire-once, denial and clean stop | Expose canonical actions through the game adapter; mobile-web gameplay check |
| 6 Aug | Before/after aggregation and integration | Vision reliability, prompted tests and permission fallback | Device test matrix; help integrate and tune the host |
| **7 Aug** | **Integration day — everyone. Full flow end to end, repeatedly, without reload. T0 complete.** | | |
| 8 Aug | **Freeze at noon.** Technical slides reviewed | Freeze at noon. Deck finalised | **Record video.** README and disclosure review |
| 9 Aug | Standby for blocking bugs | Submit. **No code** | Standby |

The portable types and binding skeleton now exist on Lucius's review branch. The immediate
integration blockers are reviewing that contract and receiving Mark's canonical action table;
game-specific wiring should not be guessed before those two interfaces agree.

**Integration day is not optional.** Three people building in parallel for a week will have
integration problems and there must be a day budgeted for finding them.

**If behind on 5 August:** cut all mapping polish, reduce to a single discrete remappable command, and protect
the integration day. A complete honest T0 beats a broken ambitious build — Build Quality is
judged on whether it *functions end-to-end in a live setting*.

---

## 9. Tracks

Availability varies. The ship ladder exists so reduced capacity changes **which tier is
reached**, not whether there is a submission. See [STATUS.md](STATUS.md) for the short version.

### The shape of the work

```
ActionBus → Calibration → Scorer → Recommender → Before/After    ← SERIAL, one owner
     ↑
TouchControls · GestureInput · (FaceInput)                       ← PARALLEL, one each
     ↓
Screens · deck · video · deployment                              ← PARALLEL
```

The **spine** is serial and cannot be split: each stage consumes the previous one's output.
**Channels** are independent implementations of one interface — they share no state, live in
separate files, and parallelise perfectly.

Do not split the spine by channel. Three channels and no recommender is nothing; one channel and
a complete spine is the entire demo.

### Allocation

| Role | Owns | Rationale |
|---|---|---|
| **Lucius — Core & Touch** | Portable spine, web touch adapter, calibration records, scorer, recommender, live rebind and final integration | This is the serial critical path and owns the public package contract. |
| **Vivin — Vision Input** | `GestureInput` (MediaPipe), camera lifecycle behaviour and vision calibration integration | The channel emits neutral signals and never imports or names Swarmfall. |
| **Mark — Demo Host** | Canonical Swarmfall mechanics, game action contract, host adapter, responsive mobile-web UI and real-phone testing | The demo consumes the layer; it never defines middleware internals. |

**Deliverables.** Deck content goes wherever the thesis is best understood, with technical slides
reviewed by Core. Device testing, the demo script and raw recording sit with Touch Input &
Quality. No single role absorbs all three deliverables.

### Working rules
- Branch per person, PRs **merged same day**. A three-day branch is a merge conflict with interest.
- `git pull` on `main` before starting each day.
- Never two people in one file — the allocation above makes this automatic.
- **Types with empty implementations merge first.** The only blocking dependency in the project.
- Update [DISCLOSURE.md](DISCLOSURE.md) the moment a dependency is added.
- Do not add scope because a tier finished early.

---

## 10. Acceptance criteria

### 31 July
1. Repo live and private; collaborators accepted.
2. Swarmfall source confirmed exportable and extensible.
3. Types merged: `GameAction`, `InputSourceId`, `ActionBus`, `BindingMap`, `InputChannel`.
4. **Binding-gate test passes.** With `RECALL → TOUCH_RECALL`, a touch emission dispatches and a
   gesture emission does not. After rebinding, the reverse holds. **In both configurations, both
   emissions appear in telemetry.**

### 2 August
5. Swarmfall runs from the deployed HTTPS URL on a real phone.
6. Directional movement and discrete commands route through the game `ActionBus`. Browser
   pointer/touch APIs stay in the input adapter and do not appear in simulation logic.
7. `npm run build` passes with `strict: true`, zero errors.

### 7 August — T0 complete
8. Full flow runs end to end without a reload.
9. Calibration produces per-channel metrics for touch and gesture on an identical task.
10. Recommender emits a recommendation with a plain-language explanation.
11. **Accept rebinds at runtime and the gesture visibly works in round 2.** Reject changes nothing.
12. Only the newly bound source dispatches the command; attempts from the old source remain in
    pre-gate telemetry for before/after comparison.
13. Before/after screen shows calibration deltas, with the practice confound noted.
14. HUD shows detected input, confidence, mapped action, latency.
15. Camera denial leaves the game fully playable on touch.

---

## 11. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Swarmfall source not exportable or not extensible | **Critical** | Confirm 31 July. Complete source is a required deliverable |
| Rebinding requires code changes → demo impossible | **Critical** | D1 + D4, built first, with a passing gate test |
| No ground truth for accuracy | **Critical** | D2 prompted cue-response |
| Tracks do not integrate | **High** | 7 August is a dedicated integration day |
| Gate blocks telemetry → no before/after data | **High** | D5 gate on dispatch only, record pre-gate |
| HTTPS not ready → camera blocked | **High** | D12 deploy before building features |
| MediaPipe tanks frame rate | **High** | D7 one model at a time; 10–15 fps inference |
| No discrete commands in Swarmfall → thesis has no surface | **High** | §3 — the one structural requirement of integration |
| Uneven availability | **High** | Ship ladder; every tier boundary is a valid stop |
| Middleware claim reads as one game with custom controls | Medium | T2 second host, or the integration snippet in §1 as the minimum defence |
| One trial flips the recommendation | Medium | §5.1 adaptive trial count |
| Gesture latency worse than touch | Medium | D3 — it *will* be. Report honestly; it is the tradeoff the recommender arbitrates |
| Before/after confounded by practice | Medium | §5.4 calibration is the headline metric |
| Natural-language mapping is not ready | Low | Explicitly deferred; T0 proves measured input mapping without it |

---

## 12. Honesty and framing constraints

Applies to code, video and deck.

- One human input maps to one approved game action. No macros in real time.
- **Channels differ in speed and reliability, never in capability (D16).** Every command reachable
  by gesture is also reachable by touch.
- No aim assistance. No reading live game state to make real-time input decisions.
- Recognition runs **on-device**. Raw camera data never leaves the device.
- Binding changes require explicit user approval, between rounds only.
- **The recommender advises; it never blocks (D8).** Where a mapping is poorly suited, the cost
  is quantified and the player still decides.
- Channels claimed as *provided* are those that actually run — currently touch and hand gesture.
  Face, tilt and sound are described as designed, not delivered.
- **Never claim simulated input noise proves accessibility effectiveness for real disabilities.**
- Use real traces. Describe scripted traces only as engineering stress tests.
- Describe calibration as **adaptive stopping, not a controlled trial**.
- Framed as **publisher-integrated middleware**, not an unauthorised overlay.
- Anything unshipped is presented as **designed, not shipped**, with the interface as evidence.
- Swarmfall is the demo host. The deck leads with the problem and the layer — a swarm game by
  itself has no problem statement, and Problem–Solution Fit is 40%.

---

## 13. Open questions

Resolved by the case brief: technology restrictions (none), deliverables (deck / code / video),
judging weights (40/30/30), timeline.

Still open:

1. **Cue modality.** The calibration cue is currently visual. A visual cue competes for the
   attention the gesture channel also needs, which may inflate gesture latency relative to touch —
   a confound in the direction that flatters touch. Audio cue, or both?
2. **What the video leads with.** Prefer the recommendation moment: measure touch and fist,
   explain the evidence, accept the change, then show the new binding working in the same game.
   Decide whether directional pointing appears as a short T1 preview or stays out of the final cut.
3. **Does T2 get built?** Decide 5 August based on integration progress.
