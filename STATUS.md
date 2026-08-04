# Project Status

**3 August 2026 · build until 8 Aug, submit 9 Aug**

The specification is in [PLAN.md](PLAN.md). Swarmfall is the mobile-web demo host; the
adaptive-input layer is the product.

## Current product decision

- **T0 first:** remap one existing discrete game action between its normal touch control and a
  closed fist, then measure, recommend, ask for approval and validate the new binding.
- **T1 next:** map touch-pointer and hand-point direction to the same continuous directional game
  action, with a direction-ended signal so movement cannot get stuck.
- Do not add strategy generation, macros, button-layout adaptation or native-app packaging to T0.
- The browser demo is appropriate for now: it can run on a phone over HTTPS and exercise real
  touch and camera hardware. Native Android/iOS game adapters are future portability work.

## Working rules

- Branch per person; review before merging to `main`.
- Pull `main` before starting new work.
- Never let two people own the same file.
- Import the middleware only through its public `src/index.ts` entry point.
- `packages/adaptive-input/` never imports from `demos/`.
- Add every dependency, model and API to [DISCLOSURE.md](DISCLOSURE.md).
- Keep pointer, touch and camera APIs inside input adapters, never simulation logic.

## Current progress

| Status | Item |
|---|---|
| Pushed for review | Lucius's portable core skeleton on `core/adaptive-input-skeleton`: typed actions, defaults, binding gate, pre-gate telemetry, channel lifecycle and shared calibration harness |
| Pushed prototype | Vivin's cleaned source on `vision/calibration-prototype` at `b910147` |
| Manually checked | Vivin's browser prototype detects a closed fist and reports a live point vector |
| Local review change | Lucius's fallback Swarmfall now uses continuous directional control: release stops; switching squads transfers the active direction |
| Pushed for review | Scoring and recommendation are implemented on `core/adaptive-input-skeleton`: neutral task scores, persistent calibration profiles and comparison-first recommendations pass executable checks |
| Pushed for review | `/calibration` compares touch/fist using 6-trial quick or 12-trial full tests and counts accidental activations during WAIT |
| Pending | Mark exports the canonical Swarmfall source and publishes the real action/payload table |
| Implemented; verification pending | Vivin's detector is behind `InputChannel`, emitting closed fist, normalized point direction and explicit direction-ended signals |
| Pending | Add explicit player approval, live rebind and before/after validation using the completed scorer and recommender |
| Pending | Real-phone HTTPS testing and final integration; camera/model failures now return an unavailable channel while touch remains available |

The local directional host is a temporary test object while Mark is unavailable. It must not be
treated as Mark's canonical game or merged over his work without review.

## Ownership

| Owner | Owns | Must not own |
|---|---|---|
| **Lucius — Core & Touch** | Public middleware contract, binding gate, telemetry, web touch adapter, scorer, recommender, final integration and temporary fallback host | Vivin's recognition internals or Mark's canonical game mechanics |
| **Vivin — Vision** | MediaPipe loading, camera permission, closed-fist stability/fire-once, point-vector output, confidence, clean start/stop and vision calibration integration | Swarmfall actions, binding policy or game behaviour |
| **Mark — Demo Host** | Canonical Swarmfall mechanics, action/payload table, game-side adapter, responsive mobile-web UI and real-phone gameplay testing | Middleware core, camera recognition or recommendation policy |

## Immediate handoffs

### Lucius — Core & Touch

1. Get the pushed core/calibration feature branch reviewed before merging it into an integration branch.
2. Ask Mark for the canonical action list before choosing the final T0 command.
3. Keep the middleware contract game-agnostic: it sends an action and typed payload, never worker
   instructions.
4. Port one normal touch control behind `InputChannel` and calibrate it with the same cue task used
   for fist.
5. Use the completed scorer and recommender to add explicit Accept/Reject, live rebind and
   before/after results.
6. Use the local directional Swarmfall only as the integration host until Mark's code is ready.

### Vivin — Vision

1. Record the exact MediaPipe package version and the source/version of every model and WASM file.
2. Move camera/MediaPipe code behind `InputChannel`; it must not import or name Swarmfall.
3. Emit a neutral closed-fist source event after a short stable hold, exactly once per hold, and
   require the hand to open before it can fire again.
4. Include a monotonic timestamp and confidence on emitted samples so Lucius can score latency and
   reliability.
5. Leave point direction as a neutral normalized `{ x, y }` sample plus confidence, and emit a
   direction-ended signal when pointing is lost or stopped. This is T1, after fist works end to end.
6. Add prompted point calibration for T1: show a target direction and let code calculate angular
   error between the target and detected vector. The user does not judge the angle.
7. Camera denial, recognition failure and channel stop must release the camera and leave touch
   playable.
8. Provide run steps and evidence for build, fire-once/release, point output and denial behaviour;
   label anything not tested `UNVERIFIED`.

#### Vision phone test record

Physical-device verification is **UNVERIFIED** until the following is recorded on the deployed
HTTPS build. Do not infer these values from desktop testing.

| Field | Result |
|---|---|
| Phone model | UNVERIFIED |
| Operating system and version | UNVERIFIED |
| Browser and version | UNVERIFIED |
| Lighting conditions | UNVERIFIED |
| Left produces negative x / right produces positive x | UNVERIFIED |
| Camera denial leaves touch playable | UNVERIFIED on phone |
| Repeated start/stop releases camera indicator | UNVERIFIED on phone |

### Mark — Demo Host

1. Export the canonical game source to a separate branch; do not replace `main` before review.
2. Publish this table for every player command:

   ```text
   action name · payload shape · discrete or continuous · existing game effect
   original touch control · fixed or remappable · start/update/end behaviour
   ```

3. Include at least one existing zero-payload discrete command suitable for the T0 fist mapping.
4. For directional movement, accept one normalized direction for the selected squad and a clear
   stop/end command. Mark decides how that squad-level action maps to workers.
5. Keep original touch controls available; the middleware adds or reassigns input sources and does
   not invent stronger game behaviour.
6. Confirm that the responsive browser build works on a real phone over HTTPS.

## Integration boundary

```text
touch or camera → InputChannel → BindingMap → typed game action → Mark's game adapter → game
                     ↘ pre-gate telemetry → scorer → recommendation → player approval
```

In plain language: Vivin reports what the hand did, Lucius decides whether that input is currently
allowed to trigger an existing action, and Mark's game decides what that action does. None of the
three parts needs to understand the internals of the other two.

## Delivery ladder

| Tier | Contents | Status |
|---|---|---|
| **T0** | One discrete live rebind, touch + fist calibration, recommendation, approval, before/after and mobile HTTPS demo | Core, calibration, scoring and recommendation complete; live rebind not yet end to end |
| **T1** | Point-direction mapping, direction calibration and additional allowlisted mappings | Conditional after T0 |
| **T2** | Second host proving portability | Conditional |
| **T3** | Extra gesture, face or tilt channels | Conditional |

Natural-language mapping is deferred until T0 is reliable. If added later, it may select an
allowlisted input-to-action mapping ID; it will not generate strategy or executable logic.

## Verification required for every handoff

- Run `npm run check:adaptive` for middleware work.
- Run `npm run build` for every repository change.
- Paste actual output; label anything not tested as `UNVERIFIED`.
- List every changed file.
- No secrets, `.env` files, ZIP archives, `node_modules` or generated build folders in commits.

## Submission checklist

- Deck PDF, maximum 15 slides.
- Source repository with architecture, setup and disclosure documentation.
- Video, maximum five minutes, showing the complete flow on a real phone.
- HTTPS demo URL.
- Final Google Drive submission on 9 August; no post-submission edits.
