# Adaptive Input Layer — Implementation Plan v6

**Garena AI Build Challenge 2026**

> The specification. For current progress, milestones and work split see [STATUS.md](STATUS.md).
> v6 reflects the released case brief and the shift to a middleware product with Swarmfall as
> demo host.

---

## 0. Constraints

| Item | Value |
|---|---|
| Plan date | 30 July 2026 |
| Submission | **9 August 2026** — deck, source code, video |
| Finalists announced | 13 August · Final presentations 23 August |
| Team | 3 members, full team from 1 August |
| Toolchain | Node 22, Vite, TypeScript, Phaser, MediaPipe |

### Judging weights

| Criterion | Weight | What it rewards |
|---|---|---|
| **Problem–Solution Fit** | **40%** | Clarity of problem, user understanding, strength of solution, suitability of AI, **prioritisation of trade-offs** |
| Build Quality | 30% | Functions end-to-end **in a live setting**, reliability, **genuine use of AI-driven behaviour**, soundness of integration |
| Originality | 30% | Originality of insight, differentiation from existing products, uniqueness of execution |

Two consequences. First, the largest criterion is judged mostly on the deck, not the code — the
decision log in §2 is deck material, not internal scaffolding. Second, "genuine use of
AI-driven behaviour" is what punishes a decorative LLM, which is why the LLM component sits at
T1 rather than last.

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
  { id: 'LASSO',  requirements: { spatial: true,  latencyCritical: false } },
  { id: 'RECALL', requirements: { spatial: false, latencyCritical: false } },
  { id: 'HOLD',   requirements: { spatial: false, latencyCritical: false } },
]);

adaptive.on('RECALL', () => swarm.recall());
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
| D8 | **The recommender warns; it never blocks.** Actions whose requirements are poorly served by a channel produce a warning with a **quantified cost**, and the player may override it. | Refusing to let a player remap their own controls is paternalistic, and paternalism is the wrong posture for an accessibility product — the premise is that the player knows their own needs. Quantifying the cost ("your lasso accuracy was 91% on touch and 64% on gesture") is still evidence the system reasons about requirements, while leaving the decision where it belongs. |
| D9 | **The layer never imports from `demos/`.** | The one-way dependency is what makes the portability claim verifiable rather than asserted. |
| D10 | **Hand gesture is channel #1.** Face and tilt are T3. | `GestureRecognizer` ships canned categories and confidence scores. Proves the pipeline cheapest. |
| D11 | **Face input, if built, uses blendshapes (`jawOpen`), never head pose.** | A handheld phone moves with the player's hands, corrupting camera-relative head pose. Blendshapes are face-relative and substantially less affected — though still degraded by poor lighting, occlusion and talking. Not immune. |
| D12 | **Deploy to HTTPS before building features.** | `getUserMedia` needs a secure context; LAN access over plain HTTP silently blocks the camera. Also the submission artifact. |
| D13 | **The LLM fills slots in a fixed schema validated server-side.** It never generates freely, never enters the real-time loop, never writes gameplay code. | Player creativity comes from combining allowlisted primitives. Unbounded generation cannot be validated and will break in demo. |
| D14 | **The recommender is a transparent rule set, not a trained model.** | It must justify itself to the player before changing their controls. Explainability is the feature, not a limitation. |
| D15 | **Only one adaptation is implemented: moving an action to a different channel.** Layout findings are advisory text, never auto-applied. | Auto-applying layout changes is a second system with its own failure modes, and layout advice needs more samples than calibration provides. |
| D16 | **Channels may differ in speed and reliability. They must never differ in capability.** | Every command reachable by gesture must also be reachable by touch. Otherwise the alternative channel is a power-up, the accessibility framing collapses, and a judge correctly calls it a cheat. |

---

## 3. Demo host: Swarmfall

Swarmfall is a real-time swarm control game: the player lassos territories, units divide
themselves among targets inside the loop, harvesters extract and bank ore, guards intercept
threats. Sixty-second rounds.

**Why it fits the thesis better than a conventional action game:**

- Units act autonomously, so **input bandwidth is low**. The player issues occasional commands
  rather than continuous twitch input — which is precisely what makes alternative channels
  viable. The genre supports the argument rather than merely hosting it.
- The loop is **bursty**: draw, let the swarm work, redraw. Those gaps are where a gesture fits,
  so the hands-on-screen conflict is far less severe than in a shooter.
- The lasso is **obviously spatial**, so the recommender's advice against moving it — and the
  measured precision cost it quotes — is self-evidently sensible rather than a designed contrivance.

### Actions

Swarmfall already has both controls the thesis needs. **T0 requires no new gameplay features.**

| Action | Requirements | Role | Status |
|---|---|---|---|
| `LASSO` | `spatial: true` | Territory indicator. Remappable, but **warned against with a quantified precision cost (D8)** | exists |
| `SWITCH_TYPE` | discrete, non-urgent | **The remap candidate** — miner / defender toggle | exists |
| `RECALL`, `HOLD` | discrete, non-urgent | Extra remap candidates; more primitives for the T1 grammar | **optional, T3** |

The demo is therefore *"closed fist switches between miners and defenders"* — no new game code.

`RECALL` and `HOLD`, if added, are deliberately **declarative player intents** — return to core,
stop and defend — with no reading of live game state. A command that inspected the world to pick
its own target would be a macro, and that is what §12 rules out.

**The 2–3 discrete commands must be added.** Without them there is nothing to measure or remap,
and the thesis has no surface in this game. This is the one structural requirement of the
integration.

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

```
TouchControls ─┐
GestureInput  ─┼─► ActionBus.emit(action, { source, timestamp, ... })
FaceInput     ─┘
                        │
                        ├──────────────► TelemetryRecorder   (PRE-GATE, D5)
                        ▼
              BindingMap.get(action) === payload.source ?     (D4)
                        │
                 no ────┴──── yes
                 │             │
                 ▼             ▼
        log as rejected   dispatch to listeners
```

Accepting a recommendation is one line, at runtime:

```ts
bindings.set('RECALL', InputSourceId.HAND_CLOSED_FIST);
```

### 4.2 Typed payloads

Continuous actions carry a vector; discrete actions carry confidence. One loose type cannot
serve both.

```ts
type Payload<A extends GameAction> =
  ActionPayloadMap[A] & { source: InputSourceId; timestamp: number };

emit  <A extends GameAction>(action: A, payload: Payload<A>): void;
listen<A extends GameAction>(action: A, fn: (p: Payload<A>) => void): void;
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
    │   ├── TouchTelemetry.ts   channel                         [touch]
    │   └── GestureInput.ts     channel                         [vision]
    ├── calibration/         cue-response harness               [core]
    ├── recommendation/
    │   ├── InputScorer.ts       samples → per-channel numbers  [touch]
    │   └── ControlRecommender.ts  rules + explanations         [core]
    └── data/                SessionTelemetry, PlayerProfile    [core]

demos/
├── swarmfall/               host 1 — the demo                  [core]
└── survivor/                host 2 — portability proof (T2)
```

`packages/adaptive-input/` must never import from `demos/` (D9).

### 4.4 Stack

```text
TypeScript (strict) · Vite · Phaser 3.90.x · @mediapipe/tasks-vision
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
| Miss distance | touch | px from button centre for failed taps |
| Drift | touch | touchstart → touchend displacement |
| Directional bias | touch | mean offset vector |
| Repeat-tap rate | touch | % of taps <150 ms after the previous |
| Stability time | vision | ms held above threshold before trigger |
| Confidence (median) | vision | model score at trigger |
| In-game command success | all | attempted vs succeeded, during a round |

Persisted to `PlayerProfile` in localStorage.

### 5.3 Recommender rules

```text
── IMPLEMENTED: channel remapping ──

IF action.spatial OR action.latencyCritical                    (D8)
    → do not recommend moving it.
      If the player chooses to move it anyway, show a warning quantifying
      the measured cost from calibration, and allow the override.
      e.g. "Lasso accuracy: 91% on touch, 64% on gesture.
            Precision will drop. Move it anyway?"

IF touch.successRate < 0.80
   AND alt.successRate > touch.successRate + 0.10
   AND alt.falseActivationRate <= 1.0 per minute
    → recommend moving the action to alt

IF alt.falseActivationRate > 1.0 per minute
    → never recommend alt, regardless of accuracy

── ADVISORY TEXT ONLY, never auto-applied (D15) ──

IF mean tap offset > 25% of button radius
   AND >= 60% of taps fall on the same side of centre
    → "your taps land consistently <direction> of centre"

IF >= 20% of failed taps land within 1.5x button radius
    → "a larger hitbox would have captured N of your misses"

IF repeat-tap rate > 15%
    → "frequent double-taps detected; a longer debounce may help"
```

Bias is a **proportion of button radius**, not a fixed pixel count, so it scales across devices.
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
| LLM (constrained schema) | Interprets player constraints; composes commands from an allowlisted primitive grammar | Server-side function, between rounds |

### The primitive grammar (T1)

Games declare their available primitives. The layer exposes the combinatorial space. Players
compose in natural language.

```text
{unit type} × {target selector} × {formation} × {trigger condition}
```

Swarmfall declares `{guards, harvesters} × {nearest-threat, core, largest-cargo} ×
{surround, spread, intercept}`. A player who types *"keep my guards between the core and whatever
is incoming"* gets `guards × nearest-threat × intercept` — a standing order they can name
themselves. Nothing is hardcoded; the command did not exist until the player described it.

Composed presets are **standing orders set between rounds**, not real-time macros. The
distinction matters: a standing order is a policy the player configures in advance and can see
running, which is ordinary strategy-game delegation. A macro is one input firing a timed
sequence during play, which §12 rules out.

Every axis is allowlisted, so every output is validated before reaching any game. Creativity
comes from combinatorics rather than free generation (D13). A different game declares different
primitives and the same layer works unchanged — which is a much stronger claim than "the LLM
understands our game."

The player also states constraints in natural language — *"I'm playing one-handed," "my thumb
gets tired"* — which the LLM converts into weightings the rule-based recommender consumes. The
rules still decide; the model interprets and explains.

API credentials live in server-side environment variables, never in client code or the
repository.

---

## 7. Ship ladder

Each tier is independently demoable. Work stops wherever the schedule lands.

### T0 — Core · cannot be cut
- Swarmfall integrated: lasso and 2–3 discrete commands all routed through `ActionBus`
- `BindingMap` with dispatch gating (D4) and pre-gate telemetry (D5)
- Calibration: cue-response, adaptive trials, no-cue window — touch **and** gesture, identical task
- MediaPipe gesture → one discrete command
- Recommender with plain-language explanation, and a quantified warning on `LASSO` that the
  player can override
- **Accept → live rebind → visibly works in round 2**
- Before/after screen
- Live HUD: detected input, confidence, mapped action, latency
- Deployed HTTPS URL

### T1 — AI legibility
LLM primitive grammar and constraint interpretation (§6). Off the critical path — a serverless
function, a fetch, an allowlist check. This tier is what "genuine use of AI-driven behaviour"
in the 30% Build Quality criterion is asking for.

### T2 — Portability proof
Second demo host: the survivor game cut to the bone — arena, movement, one enemy, one ability.
Turns the middleware claim from asserted to demonstrated. Pre-empts the obvious judge objection:
*"you built one game with custom controls and called it a platform."* ~1.5 days, conditional on
Swarmfall integration going smoothly.

### T3 — Polish
Advisory layout text · second gesture · face blendshape channel · tilt channel · JSON export ·
sprite art.

### Cut
Custom-trained gestures · sound input (pitch thresholding is not itself an ML feature, and game
audio interferes with mic input) · head pose · auto-applied layout changes · multiplayer ·
procedural content.

Anything cut is presented in the deck as **designed, not shipped**, with the schema or interface
as evidence. Explicit prioritisation reads as judgment; silence reads as abandonment. The brief
explicitly rewards "prioritisation of trade-offs."

---

## 8. Schedule

| Date | **Core & Integration** | **Vision Input & Screens** | **Touch Input & Quality** |
|---|---|---|---|
| **1 Aug** | **Merge the types first**, before anything else. Then route Swarmfall's existing `LASSO` and `SWITCH_TYPE` through `ActionBus` | Read the interface. Camera permission, MediaPipe loading | Read the interface. `TouchTelemetry` against Swarmfall's existing buttons |
| 2–3 Aug | Calibration harness — cue-response loop, adaptive trials, no-cue window | `GestureInput` — closed fist, confidence threshold, stability window, fire-once, denial path | `TouchTelemetry` complete; `InputScorer` — samples → per-channel numbers |
| 4–5 Aug | `ControlRecommender` — rules, explanation text, Accept/Reject, **live rebind** | Calibration and recommendation screens | Results / before-after screen; balance tuning |
| 6 Aug | Before/after aggregation | **T1** LLM grammar if clear | Device test matrix; demo script written and timed |
| **7 Aug** | **Integration day — everyone.** Full flow end to end, repeatedly, no reload. **T0 complete** | | |
| 8 Aug | **Freeze at noon.** Technical slides reviewed | Freeze at noon. Deck finalised | **Record video.** README, DISCLOSURE |
| 9 Aug | Standby for blocking bugs | Submit. **No code** | Standby |

**The types merge is the only blocking dependency in the project.** It is twenty minutes of empty
interfaces and it must be pushed before Swarmfall integration begins — otherwise two roles sit
idle on day one.

**Integration day is not optional.** Three people building in parallel for a week will have
integration problems and there must be a day budgeted for finding them.

**If behind on 5 August:** cut T1, reduce to a single discrete remappable command, and protect
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
| **Core & Integration** | Swarmfall integration, then the **spine** — `ActionBus`, `BindingMap`, calibration harness, `ControlRecommender`, live rebind | Integration requires familiarity with the Swarmfall codebase, so it goes wherever that knowledge already is. The spine is algorithmic and testable and needs no game-development experience. **This is the largest share of the product and it runs all week — not a setup task followed by a handoff.** |
| **Vision Input & Screens** | `GestureInput` (MediaPipe), then the calibration and recommendation screens | The highest-risk single component in the project: T0 fails without a working alternative channel. Allocate accordingly. |
| **Touch Input & Quality** | `TouchTelemetry`, **`InputScorer`** (samples → numbers, all channels), results screen, tuning, device testing, demo script | Swarmfall's buttons already exist, so this role instruments them rather than building them. `InputScorer` moves here to take one item off the serial critical path: it is pure data transformation with a clean contract, and this role already derives touch-specific summaries. |

**Why `InputScorer` sits outside Core.** Core is the bottleneck — every stage of the spine
depends on the previous one. `InputScorer` has no coupling to the harness internals, so moving it
off shortens the serial chain. The dependency is handled by the same day-one trick: **Core defines
the scorer's output type in the types merge**, codes the recommender against that type
immediately, and stubs it with fixed numbers if the implementation runs late.

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
6. Lasso and all discrete commands route through `ActionBus`. **Zero direct pointer/touch API
   references in game logic.**
7. `npm run build` passes with `strict: true`, zero errors.

### 7 August — T0 complete
8. Full flow runs end to end without a reload.
9. Calibration produces per-channel metrics for touch and gesture on an identical task.
10. Recommender emits a recommendation with a plain-language explanation.
11. **Accept rebinds at runtime and the gesture visibly works in round 2.** Reject changes nothing.
12. Recommender does not recommend remapping `LASSO`; if the player overrides, it shows the
    **quantified precision cost** from calibration and still applies the change.
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
| LLM API access unresolved | Medium | T1 is off the critical path; T0 does not depend on it |

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
3. **What the video leads with.** The recommendation moment (accept → rebind → it works) or the
   caution moment (the layer quantifies what moving the lasso would cost, then lets the player
   decide anyway)? The caution moment is more distinctive but needs more setup in a 5-minute video.
4. **Does T2 get built?** Decide 5 August based on integration progress.
