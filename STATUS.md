# Project Status

**6 August 2026 · team review pending · formal integration planned for 7 August · submit 9 August**

The specification is in [PLAN.md](PLAN.md). Swarmfall is the mobile-web demo host; the
game-agnostic adaptive-input layer is the product.

## Current product decision

- The current integrated Swarmfall is the candidate demo host after Mark confirmed that its
  controls are similar enough to continue from this version. It is still pending team review.
- **T0:** measure touch and a visual trigger on the same task, compare them, let the player approve
  or reject a remap, and make that runtime binding control a normal game action.
- **T1:** map native touch direction and hand-point direction to the same continuous game action,
  including an explicit direction-ended signal so movement cannot remain stuck.
- Closed fist, open palm and thumbs up are allowlisted trigger inputs. Pointing is a directional
  input. The game determines what every registered action does.
- Strategy generation, macros, button-layout adaptation and native-app packaging remain out of
  scope. The browser demo runs on real phone touch and camera hardware over HTTPS.

## Review branch

- Review target: `integration/adaptive-controls-mvp`
- Integration baseline: `99446a3` (`Add dynamic vision calibration inputs`), which already
  contains the earlier `eaf356b` four-control demo work.
- Latest local commit: `f817b49` (`fix: scale squad zones for mobile arenas`).
- This branch combines the tracks for review. It does not replace Vivin's vision branch, Mark's
  demo branch or `main` before approval.

## Current progress

| Area | Status | Evidence / remaining work |
|---|---|---|
| Typed actions, defaults and binding gate | Complete locally | Strict checks cover accepted and rejected dispatch. |
| Pre-gate telemetry | Complete locally | Both accepted and rejected attempts are retained. |
| Touch trigger and touch direction | Complete locally | Touch buttons and pointer joystick route through the adaptive boundary. |
| Visual trigger inputs | Complete locally | Closed fist, open palm and thumbs up emit neutral trigger signals. |
| Visual direction | Complete locally | Pointing emits normalized direction and explicit direction-ended signals. |
| Trigger calibration | Complete locally | Six-trial quick and twelve-trial full modes; WAIT activations are counted. |
| Direction calibration | Complete locally | Eight randomized cues; latency, angular error, jitter and dropouts are shown. |
| Score memory and recommendation | Complete locally | Results persist by neutral task and input source; comparisons remain transparent. |
| Binding settings | Complete locally | Choose action and input, test or skip, review, accept, keep or restore default. |
| Runtime rebind | Complete locally | Phone smoke tests confirmed bindings change and survive refresh. |
| Gesture training | Complete locally | Live camera feedback previews gather, spread, switch and direction without rebinding. |
| Mobile Swarmfall host | Complete locally; review pending | Directional control, optional tactics, responsive zones and phone layout are working. |
| Control comparison and live validation | Complete locally | Touch and alternative-input measurements are compared before approval; the accepted binding is then verified in gameplay. |
| Runtime input feedback | Complete locally | Gameplay shows detected input, confidence and mapped action. Reaction latency is measured only during prompted calibration. |
| HTTPS deployment | Temporary | The Cloudflare review tunnel works but is not a durable submission deployment. |
| Formal integration | Pending | Team review, shared-branch verification and merge to `main` are planned for 7 August. |

## Changes since integration baseline `99446a3`

### Demo game and mobile behavior

- Restored press-and-drag directional squad control in place of lasso movement.
- Direction is constant-strength, release/cancel stops it, and squad switching transfers an
  active direction to the newly selected squad.
- Kept normal mining and defending functional without any selected tactic.
- Removed the redundant spread tactic; Gather and Spread are direct squad commands.
- Made tactic selection activate immediately without a separate activation button.
- Kept Miner Protect and Guard Escort as optional support behaviors only.
- Assigned Guard Escort using the nearest currently available guard and eligible loaded miner.
- Made empty and loaded miners collide with asteroids so Miner Protect has a visible purpose.
- Corrected guard and miner activity-zone behavior and bounded idle destinations.
- Replaced idle spinning with slow randomized patrol movement inside each squad's zone.
- Kept each squad's formation and activity state independent.
- Added responsive mobile scaling for activity zones, formation spacing, patrol ranges, targeting
  boundaries and initial local ore placement while preserving desktop sizing.
- Kept gameplay input abstract: simulation code consumes typed actions and does not read touch or
  camera APIs directly.

### Adaptive binding and control flow

- Connected Gather, Spread, Switch Squad and Direct Units through the adaptive action boundary.
- Added catalogue-driven settings so the host supplies labels, requirements and defaults without
  adding game knowledge to the middleware.
- Added action → alternative input → saved result or test → review → accept/keep flow.
- Added an explicit use-without-testing path that records no recommendation.
- Kept the Controls panel open after accepting or rejecting so more actions can be configured.
- Added restore-default behavior and local binding persistence.
- Added global-input conflict detection: assigning one global gesture to a second action restores
  the conflicting action's default before applying the new mapping.
- Ended any active direction before changing its source so movement cannot be left running.
- Corrected routing so one detected trigger maps to one currently bound action rather than
  activating several commands.
- Added whole-scheme touch/gesture switching while retaining per-action custom bindings.

### Vision channel and reliability

- Kept MediaPipe and camera code behind a game-blind `InputChannel`.
- Emit closed fist, open palm and thumbs up with monotonic timestamps and confidence.
- Emit normalized pointing direction and a direction-ended event when pointing disappears,
  another trigger pose begins, the camera stops or the channel fails.
- Hardened repeated start/stop, overlapping startup, camera-track termination and recognizer
  cleanup so only one processing loop and one model remain active.
- Kept touch available when camera permission, model loading or active recognition fails.
- Run one-hand inference on a separate 10–15 fps timer rather than the game render loop.
- Added one per-hand command gate with highest-confidence arbitration, a 55% enter threshold,
  stability, cooldown and fire-once behavior.
- Allow stable direct transitions between different trigger poses without requiring pointing or a
  neutral pose between every command.
- Keep the design open for a future gate per tracked hand; two-hand inference is not implemented.
- Added calibration focus so an unrelated recognized pose cannot lock the trigger being tested.

### Calibration, recommendation and training

- Added dynamic calibration pairs derived from the current action binding and proposed input.
- Added independent touch and visual trigger modules with identical cue timing.
- Count activations during randomized WAIT periods as accidental activations.
- Record misses, anticipated responses, median latency and success rate.
- Added touch-direction and point-direction calibration with automatic angular error, stability,
  jitter and dropout measurements.
- Store reusable results by task and input source in browser storage.
- Show both controls side by side and declare a winner only when it has no measured disadvantage;
  mixed results remain a visible player choice.
- Added camera training that previews gesture effects without changing live bindings.
- Corrected training feedback and initial unit positions so Gather and Spread visibly react.

### Executable checks added or expanded

- Binding dispatch, rejected-attempt telemetry and channel lifecycle.
- Calibration score conversion, WAIT observation and profile persistence.
- Recommendation outcomes and explicit uncalibrated override.
- Settings conflicts, confirmation and default restoration.
- Gesture stability, cooldown, confidence boundary, fire-once, neutral re-arm and direct pose
  transitions.
- Vision calibration focus and direction-source rejection for trigger calibration.

### Integration commits after `99446a3`

| Commit | Change |
|---|---|
| `3862df3` | Restore directional squad control and optional support tactics. |
| `fbe7da6` | Correct adaptive routing, settings conflicts and direction handoff. |
| `b5ca8b9` | Harden vision startup, stop, failure and command lifecycle. |
| `bcae50c` | Finalize the initial adaptive-control integration and responsive settings styling. |
| `8a0fbe3` | Correct squad bounds and binding navigation/confirmation flow. |
| `305c4fd` | Add bounded idle patrol behavior. |
| `bea253f` | Correct gesture testing, calibration focus and binding flow. |
| `2ec3d32` | Tune and test the gesture confidence threshold. |
| `ecf2f0a` | Correct gesture-training feedback and preview reactions. |
| `c455794` | Allow direct stable transitions between different gesture commands. |
| `f817b49` | Scale squad zones and related behavior for narrow mobile arenas. |

## Phone smoke-test record

The following are manual observations, not a controlled device benchmark. Phone model, operating
system and browser version still need to be recorded for the submission.

| Check | Result |
|---|---|
| Touch movement stops after an interrupted drag | Passed |
| Trigger-to-trigger and point-to-trigger transitions | Passed |
| Switching squad transfers active pointing control | Passed with one-hand detection limitation |
| Held gesture fires once and can re-arm | Passed |
| Saved binding survives refresh | Passed |
| Global input conflict replaces the previous binding | Passed |
| Pointing loss stops movement | Passed |
| Landscape screen orientation | Passed |
| Camera failure/denial leaves touch available | Appeared to pass; repeat after formal integration |
| Visible camera/game lag on the tested low-end phone | None observed |
| Steep physical camera angle | Trigger classification drops at roughly 30° tilt; accepted operating condition because landscape orientation itself works |

## Known gaps and integration checks

1. Mining currently applies a fixed amount per rendered frame instead of multiplying by elapsed
   time. Compare phone and laptop extraction speed and correct it before freeze.
2. Confirm whether restored touch bindings after a camera failure are also persisted across the
   next reload.
3. Confirm the calibration-to-controls navigation and accepted binding once more after formal
   integration; a separate post-binding calibration rerun is not required.
4. Record phone model, OS, browser, lighting, left/right point signs and repeated camera-stop
   indicator behavior.
5. Deploy a stable HTTPS submission URL after merging the reviewed branch.
6. Update README, architecture/disclosure notes and the five-minute video script after behavior is
   frozen.

## Ownership during review

| Owner | Reviews |
|---|---|
| **Lucius — Core & Touch** | Public middleware contract, binding, telemetry, saved scores, recommendation and integration. |
| **Vivin — Vision & Calibration** | MediaPipe recognition, confidence, direction output, camera lifecycle and the calibration system. |
| **Mark — Demo Host** | Swarmfall mechanics, action effects, responsive gameplay and final host acceptance. |

## Integration boundary

```text
touch or camera → InputChannel → BindingMap → typed game action → game adapter → game
                     ↘ pre-gate telemetry → scorer → recommendation → player approval
```

The vision channel reports what the hand did. The binding layer decides whether that source is
currently allowed to run an action. The game alone decides what that action does.

## Delivery ladder

| Tier | Contents | Status |
|---|---|---|
| **T0** | Discrete live rebind, touch/visual calibration, recommendation, approval and mobile HTTPS demo | Functionally end to end locally; review, final validation and stable deployment pending |
| **T1** | Point direction, direction-ended signal, direction calibration and additional mappings | Implemented locally; formal integration review pending |
| **T2** | Second host proving portability | Not started; cut unless T0 is frozen early |
| **T3** | Extra channels, two-hand vision or custom gestures | Not started |

Natural-language mapping and generated strategy remain deferred. If natural-language mapping is
added later, it may select an allowlisted mapping ID only; it will not generate gameplay logic.

## Integration plan

- **7 August morning:** review this branch, agree the final action catalog and integrate into one
  shared branch without rewriting the role branches.
- **7 August afternoon:** run the full phone flow, fix blockers only, merge the approved result to
  `main` and deploy a stable HTTPS build.
- **8 August noon:** code freeze; finish deck, README, disclosure and video.
- **9 August:** submit; no feature work.

## Verification required for every handoff

- Run `npm run check:adaptive` for middleware work.
- Run `npm run build` for every repository change and retain the actual output.
- List every changed file and label anything not tested `UNVERIFIED`.
- Do not commit secrets, `.env` files, ZIP archives, `node_modules` or generated build folders.

## Submission checklist

- Deck PDF, maximum 15 slides.
- Source repository with architecture, setup and disclosure documentation.
- Video, maximum five minutes, showing the complete flow on a real phone.
- Stable HTTPS demo URL.
- Final Google Drive submission on 9 August; no post-submission edits.
