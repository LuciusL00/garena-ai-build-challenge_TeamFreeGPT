# Project Status

**8 August 2026 · integrated MVP on `main` · stable HTTPS demo available**

Adaptive Input is game-agnostic middleware that measures compatible input channels, recommends
per-action bindings, explains the evidence and changes controls only after the player decides.
Swarmfall is the full reference host; it is not the product.

Current specification and integration guidance live in [ARCHITECTURE.md](ARCHITECTURE.md) and
[packages/adaptive-input/INTEGRATION.md](packages/adaptive-input/INTEGRATION.md). Original planning
and process documents are preserved under [docs/archive/](docs/archive/).

## Product position

Mobile games are commonly built around fixed touch schemes. Available alternatives are often
game-specific, expressed as generic cursor/key controls, or manually configured without helping a
player determine which input fits which action.

The MVP closes that gap with:

```text
measure → compare → recommend and explain → player decides → validate in gameplay
```

- **Primary users:** mobile players whose preferred input varies with reach, grip, reaction speed,
  fatigue, motor ability or playing context.
- **Integrators:** developers, designers and accessibility teams.
- **Organizational stakeholders:** studios and publishers that may reuse the layer across titles.

The default umbrella term is **game teams**. Publishers are stakeholders, not direct users of the
player-facing controls.

## Current implementation

| Area | Status | Evidence |
|---|---|---|
| Typed actions and binding gate | Complete | Strict checks cover accepted and rejected dispatch; the live binding gates listeners. |
| Pre-gate telemetry | Complete | Accepted and rejected attempts are recorded before the binding check. |
| Touch input | Complete | Trigger buttons and continuous direction use the adaptive boundary. |
| Visual triggers | Complete | Closed fist, open palm and thumbs up use confidence, stability, cooldown and fire-once gating. |
| Visual direction | Complete | Hand pointing emits normalized direction and an explicit direction-ended signal. |
| Trigger calibration | Complete | Six-prompt Quick and twelve-prompt Full tests record success, response time and WAIT activations. |
| Direction calibration | Complete | Eight cues record response, angular error, jitter and dropouts. |
| Recommendation | Complete | Conservative rules explain measured advantages, trade-offs, missing evidence and action requirements. |
| Player decision | Complete | Preview, accept, reject, skip testing, restore default and conflict resolution are implemented. |
| Persistence | Complete | Calibration profiles, vision tuning and host bindings use validated browser storage. |
| Vision tuning | Complete | Per-pose hold tests, pointing stability and automatic 10/12/15 FPS measurement are saved per device. |
| Camera lifecycle | Complete | Repeated start/stop, model cleanup, track termination and failure-to-touch fallback are handled. |
| Six remappable actions | Complete | Gather, Spread, Switch squad, Direct units, Miner Protect and Guard Escort share semantic bindings. |
| Gesture mirror | Complete | Gameplay shows the live camera image, hand connections, detected input and mapped action. |
| Mobile layout | Complete | Portrait, laptop and landscape layouts preserve game proportions and keep controls/restart reachable. |
| Frame-independent mining | Complete | Mining progression uses elapsed time rather than rendered-frame count. |
| Portability proof | Complete | `/portability-2048` connects unchanged pinned 2048 core logic through one semantic action without importing Swarmfall; `/portability` remains a minimal developer smoke test. |
| HTTPS deployment | Complete | The public GitHub Pages origin serves the game, calibration route, assets and both portability hosts. |

## Live routes

- Swarmfall: <https://luciusl00.github.io/>
- Primary open-source portability proof: <https://luciusl00.github.io/portability-2048>
- Developer boundary smoke test: <https://luciusl00.github.io/portability>

## Architecture boundary

```text
touch or camera → neutral InputSignal → host action + typed payload
                                      ├→ pre-gate telemetry
                                      └→ BindingMap gate → game listener
```

The input channel reports what the player did. The host adapter assigns game meaning. The binding
map decides whether that source currently drives the action. The game alone decides the action's
effect.

## Recommendation and AI position

MediaPipe Tasks Vision 0.10.35 is the shipped AI component. It converts camera frames into gesture
categories, confidence and landmarks on-device. Point direction is derived locally from those
landmarks.

The recommendation layer is intentionally transparent rather than trained:

- There is no legitimate labelled dataset of players, mappings and outcomes.
- The player should see the measurements before changing controls.
- Prototype thresholds began as engineering defaults and were refined through team/device tests.
- Mixed evidence remains a visible player choice instead of being hidden in one weighted score.

No LLM or external AI API is used.

## Manual evidence record

These are development-team observations, not a controlled benchmark or formal user study.

| Check | Result |
|---|---|
| Touch direction stops after release or interruption | Passed |
| Trigger poses fire once and re-arm after neutral | Passed |
| Trigger-to-trigger and point-to-trigger transitions | Passed |
| Pointing loss ends continuous direction | Passed |
| Switching squad transfers active direction | Passed within the one-hand-at-a-time boundary |
| Accepted binding changes gameplay behavior | Passed |
| Saved binding survives refresh | Passed |
| Occupied global gesture returns the conflicting action to touch | Passed |
| Camera denial/failure leaves touch available | Observed; persistence across a later reload was not separately reverified |
| Landscape layout exposes game controls and restart | Passed |
| Redmi Note 11 Pro before automatic camera-rate selection | Visible lag observed |
| Redmi Note 11 Pro automatic camera-rate selection | Selected 10 FPS; smooth afterward |
| Lenovo Legion 5 automatic camera-rate selection | Selected 15 FPS; smooth during testing |
| Steep camera angle | Recognition degraded at roughly 30° tilt in manual testing |
| 2048 touch direction through `MOVE_TILES` | Passed in a production browser build; accepted telemetry incremented and the board changed |
| 2048 camera denial fallback | Passed in a production browser build; binding returned to touch and the game remained playable |

The device models were recorded, but their OS and browser versions were not. The different 10 FPS
and 15 FPS selections are limited development-team evidence that the test makes a per-device
choice instead of always applying the lowest rate. A formal phone/laptop performance benchmark was
explicitly deferred because of the submission deadline, so these observations must not be
generalized to other devices.

## Current limitations

- Testing covers the development team only; no external user study or clinical validation was run.
- The recognizer accepts either hand but tracks one hand at a time. Hand-specific and simultaneous
  two-hand bindings are future work.
- Camera lighting, angle, grip, device load and player condition can change a saved result.
- Quick and Full trigger tests share one profile slot. Saving Quick replaces Full after an explicit
  warning.
- The package requires a small semantic-action adapter in each integrating game.
- The 2048 smoke test intentionally covers one semantic directional action. It demonstrates an
  unrelated open-source integration, not the full calibration and recommendation experience.

## Scope boundary

Shipped channels are touch button, touch direction, closed fist, open palm, thumbs up and hand
point direction. Face, tilt, sound, custom-trained gestures, natural-language mapping, generated
macros, automatic button-layout changes and cross-site profile synchronization remain deferred.

There are no known blocking runtime changes planned before the submission materials. Remaining
work is presentation and packaging: the slide deck, demo video and final Drive submission.
