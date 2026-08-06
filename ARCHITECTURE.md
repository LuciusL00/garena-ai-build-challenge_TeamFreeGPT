# Architecture

> Current implementation as of 6 August 2026. Historical alternatives remain in PLAN.md and
> CONSIDERATIONS.md; this document describes the shipped MVP boundary.

## 1. Responsibilities

The adaptive-input layer supplies input channels and assigns compatible channels to host-owned
game actions. It measures how this player performs with each source, explains the comparison and
changes a binding only after the player approves it.

The system separates input sources from game meaning. Channels emit neutral `InputSignal`
records. A host adapter supplies its own action and typed payload. `BindingMap` then determines
whether that source currently drives the action.

```text
packages/adaptive-input/     reusable layer
          ^
          | one-way dependency
          |
demos/swarmfall/             full reference host
app/portability/             minimal independent host
```

The package never imports either host.

## 2. Data flow

```text
touch or camera
      |
      v
neutral InputSignal (source, shape, timestamp, confidence)
      |
      v
host translation (action + typed payload)
      |
      +----> TelemetryRecorder records the attempt before gating
      |
      v
BindingMap.get(action) === signal.source ?
      | no                         | yes
      v                            v
record rejected attempt       dispatch to host listener
```

Two invariants are load-bearing:

1. Telemetry records before the binding check, including rejected attempts.
2. The binding map gates dispatch, not just settings display.

## 3. Actions and requirements

```ts
interface ActionRequirements {
  task: 'TRIGGER' | 'DIRECTION' | 'POINT';
  spatial: boolean;
  latencyCritical: boolean;
}

interface ActionDescriptor {
  id: string;
  requirements: ActionRequirements;
  defaultSource: InputSourceId;
  remappable: boolean;
}
```

`task` filters candidate sources and selects the matching calibration. Direction tasks compare
angular error, jitter and dropouts in addition to success and latency. A latency-critical action
requires comparable response-time evidence. A spatial action requires comparable precision
evidence. Missing required evidence produces a retest recommendation rather than a guess.

Requirements guide the recommendation but never block an explicit untested override. Original
touch controls are installed synchronously at registration and remain the safe default.

## 4. Sources, channels and payloads

An `InputSourceId` is one bindable signal, such as `TOUCH_BUTTON` or `HAND_CLOSED_FIST`. An
`InputChannelId` owns lifecycle and resources. The current `HAND_VISION` channel supplies closed
fist, open palm, thumbs up and hand-point direction while running one MediaPipe recognizer.

Host payloads remain separate from source metadata:

```ts
adaptive.emitFrom('DIRECT_UNITS', { direction: signal.direction }, signal);
adaptive.on('DIRECT_UNITS', ({ direction }) => game.directUnits(direction));
```

The vision layer reports what the hand did. Only the host decides what that means in its game.

## 5. Measurement

In-game observation cannot distinguish a missed action from no intended action. Calibration uses
prompted cue-response tasks with randomized WAIT periods:

- Quick trigger test: 6 prompts, labelled an estimate.
- Full trigger test: 12 prompts, intended for comparison.
- Direction test: 8 randomized up/down/left/right prompts.

Saved evidence includes success count and rate, median cue-to-activation latency, activations
during WAIT and its observation duration. Direction evidence additionally includes mean angular
error, jitter and dropouts.

Latency has one definition for every channel: cue onset to accepted activation. Vision therefore
includes recognition and stability delay rather than hiding it.

## 6. Recommendation

The recommender is a transparent rule set, not a trained model. It declares a source better only
when that source has a meaningful advantage and no measured disadvantage. Mixed measurements
remain a visible trade-off and the player decides.

The rules are deliberately conservative:

- A Quick Test needs a two-prompt success difference before success declares an advantage.
- One accidental activation remains visible but cannot decide a winner by itself.
- Latency differences require both an absolute and relative minimum.
- Direction comparisons use bounded differences for angular error, jitter and dropouts.
- Missing latency or spatial evidence required by the host returns a retest recommendation.

Thresholds are explicit constants in `recommendation/types.ts`. They are prototype policy, not a
medical conclusion. The UI shows the underlying counts and measurements beside every verdict.

## 7. AI, assets and privacy

MediaPipe Tasks Vision 0.10.35 is the shipped AI component. It turns camera frames into built-in
gesture categories, confidence and hand landmarks. Point direction is calculated locally from
those landmarks.

The pinned WebAssembly runtime and published float16 Gesture Recognizer model are served from the
application's own `/mediapipe/` assets. Raw frames never leave the browser. Only derived scores
and host-owned bindings persist in browser local storage.

Natural-language mapping is deferred. If added later, it may select an allowlisted mapping ID; it
will not generate gameplay logic, payloads, macros or timed command sequences.

## 8. Portability proof

Swarmfall is the full reference host. `/portability` is a separate minimal host that declares one
typed `ACTIVATE` action, keeps touch as its default, optionally binds a real closed fist and shows
accepted and rejected pre-gate attempts. It imports the public middleware API and no Swarmfall
code.

The host UI remains replaceable. A native Android, iOS or engine integration can render its own
settings and calibration screens while using the same action, signal, score and binding contracts.
