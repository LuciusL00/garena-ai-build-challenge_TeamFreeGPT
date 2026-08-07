# Integrating a host game

This is the current contract for adding the adaptive-input package to a game. Swarmfall is the
reference integration:

- Host action catalog: `demos/swarmfall/src/actionCatalog.ts`
- Host adapter: `demos/swarmfall/src/adaptiveInput.ts`
- Game action bus: `demos/swarmfall/src/actionBus.ts`
- Platform touch adapter: `demos/swarmfall/src/input.ts`
- Simulation listeners: `demos/swarmfall/src/main.ts`

The package never imports any of those files. The dependency runs from host to middleware only.

## The three boundaries

```text
platform input          host translation          existing game behaviour
touch / camera signal → action + typed payload → game action listener
        │                       │
        └→ neutral signal       └→ record, binding gate, dispatch
```

1. An input channel reports a neutral `InputSignal`: source, shape, timestamp and optional
   confidence. It never names a game action.
2. A host-owned adapter translates that signal into one of the host's declared actions and its
   typed payload.
3. `AdaptiveInput` records the attempt before checking the live binding. Accepted attempts reach
   the game listener; rejected attempts remain available in telemetry.

The middleware never reads live game state, selects units, chooses targets, creates strategies or
generates command sequences.

## 1. Declare the host's actions

The payload map is owned by the game:

```ts
interface GameActions {
  GATHER_UNITS: Record<string, never>;
  SPREAD_UNITS: Record<string, never>;
  TOGGLE_SQUAD: Record<string, never>;
  DIRECT_UNITS: { direction: { x: number; y: number } | null };
  TOGGLE_MINER_PROTECT: Record<string, never>;
  TOGGLE_GUARD_ESCORT: Record<string, never>;
}
```

Register only actions that the adaptive layer may observe or remap:

```ts
const adaptive = new AdaptiveInput<GameActions>();

adaptive.registerActions([
  {
    id: 'GATHER_UNITS',
    requirements: { task: 'TRIGGER', spatial: false, latencyCritical: false },
    defaultSource: InputSourceId.TOUCH_BUTTON,
    remappable: true,
  },
  {
    id: 'DIRECT_UNITS',
    requirements: { task: 'DIRECTION', spatial: false, latencyCritical: true },
    defaultSource: InputSourceId.TOUCH_DIRECTION,
    remappable: true,
  },
]);
```

Registration immediately installs the original source. Adopting the package therefore does not
remove working touch input.

`requirements.task` selects the compatible calibration shape:

- `TRIGGER`: one-shot actions such as a button press or closed fist
- `DIRECTION`: a held relative direction such as a joystick or hand pointing
- `POINT`: an absolute normalized position; designed in the contract but not used by Swarmfall

The recommender uses the requirements without hiding them in a weighted total:

- `task` filters compatible sources and chooses the reusable benchmark.
- Direction tasks compare angular error, jitter and dropouts as well as success and latency.
- `latencyCritical` requires comparable response-time evidence and explains measured latency.
- `spatial` requires comparable precision evidence instead of guessing when it is missing.

The player may still explicitly skip testing and override the recommendation.

Keep fixed actions outside the remappable catalog, or register them with `remappable: false`.
Swarmfall keeps Begin and Restart on its original touch/click path.

Its current catalog registers six remappable actions: Gather, Spread, Switch squad, Direct units,
Miner Protect and Guard Escort. Those names remain host-owned examples, not middleware concepts.

## 2. Describe available input sources

`BindingSettingsController` needs game-independent source metadata:

```ts
const sources: readonly InputSourceDefinition[] = [
  {
    id: InputSourceId.TOUCH_BUTTON,
    label: 'Touch button',
    tasks: ['TRIGGER'],
    scope: 'TARGETED',
    requiresCamera: false,
  },
  {
    id: InputSourceId.HAND_CLOSED_FIST,
    label: 'Closed fist',
    tasks: ['TRIGGER'],
    scope: 'GLOBAL',
    requiresCamera: true,
  },
  {
    id: InputSourceId.TOUCH_DIRECTION,
    label: 'Touch direction',
    tasks: ['DIRECTION'],
    scope: 'TARGETED',
    requiresCamera: false,
  },
  {
    id: InputSourceId.HAND_POINT_DIRECTION,
    label: 'Hand pointing',
    tasks: ['DIRECTION'],
    scope: 'GLOBAL',
    requiresCamera: true,
  },
];
```

Swarmfall also declares open palm and thumbs up as global `TRIGGER` sources. Compatible sources
are capabilities offered to a host; the middleware does not assign them game meaning.

A targeted source belongs to the control the player touched. A global source, such as a camera
gesture, does not identify a button by itself. The settings controller therefore checks that one
global source is not assigned to several actions in the same host context.

## 3. Translate neutral signals

The vision channel emits neutral input:

```ts
context.emit({
  source: InputSourceId.HAND_CLOSED_FIST,
  kind: 'trigger',
  timestamp: performance.now(),
  confidence: 0.92,
});
```

The host adapter supplies game meaning:

```ts
function handleSignal(signal: InputSignal): void {
  if (signal.source === InputSourceId.HAND_CLOSED_FIST && signal.kind === 'trigger') {
    adaptive.emitFrom('GATHER_UNITS', {}, signal);
  }
}
```

The same rule applies to direction:

```ts
if (signal.source === InputSourceId.HAND_POINT_DIRECTION && signal.kind === 'direction') {
  adaptive.emitFrom('DIRECT_UNITS', { direction: signal.direction }, signal);
}

if (signal.source === InputSourceId.HAND_POINT_DIRECTION && signal.kind === 'direction-end') {
  adaptive.emitFrom('DIRECT_UNITS', { direction: null }, signal);
}
```

A direction-ended signal is mandatory for continuous controls. It prevents movement from
remaining active when the hand disappears, stops pointing or changes to another gesture.

Touch adapters report attempts through the same `AdaptiveInput.emit()` boundary. Do not bypass
the binding gate by calling game behaviour directly.

## 4. Forward accepted actions to the game

```ts
adaptive.on('GATHER_UNITS', (payload) => gameBus.emit('GATHER_UNITS', payload));
adaptive.on('SPREAD_UNITS', (payload) => gameBus.emit('SPREAD_UNITS', payload));
adaptive.on('TOGGLE_SQUAD', (payload) => gameBus.emit('TOGGLE_SQUAD', payload));
adaptive.on('DIRECT_UNITS', (payload) => gameBus.emit('DIRECT_UNITS', payload));
adaptive.on('TOGGLE_MINER_PROTECT', (payload) => gameBus.emit('TOGGLE_MINER_PROTECT', payload));
adaptive.on('TOGGLE_GUARD_ESCORT', (payload) => gameBus.emit('TOGGLE_GUARD_ESCORT', payload));
```

Use explicit typed listeners. They are repetitive by a few lines, but TypeScript catches action
names and payload mistakes.

## 5. Render binding settings

The package supplies `BindingSettingsController`, not a universal game UI. The host may render
its state using web, native Android/iOS, Unity or another toolkit.

The intended host flow is:

```text
Choose action
→ Choose compatible alternative
→ Use saved measurements or test again
→ Review the side-by-side result
→ Use alternative or keep original
```

Calling `preview()` never changes the live binding. The host calls `confirm()` only after the
player approves the measured alternative. If the player explicitly skips testing, the host may
call `confirmWithoutCalibration()`. `reset()` restores the game's declared default source.

Before assigning a global source, inspect the conflict returned by the settings controller. If
that source already drives another action, present the conflict to the player and restore the
occupied action to its declared touch default before confirming the new assignment. One camera
gesture must not silently drive several actions.

Swarmfall opens its web calibration route and returns to the selected binding review. That route
change is a reference-host choice, not a middleware requirement. A mobile host can pause its game,
open a native calibration screen and resume its own scene afterward.

## 6. Calibrate and remember measurements

The package provides:

- `CalibrationHarness` and `scoreCalibration()` for trigger inputs
- `DirectionCalibrationHarness` and `scoreDirectionCalibration()` for relative direction
- `CalibrationProfile` and `CalibrationProfileStore` for derived measurements
- `VisionTuningStore` for device-level inference rate, per-pose trigger hold times and pointing
  stability
- `ControlRecommender` for side-by-side comparison

Profiles are keyed by neutral task and source, such as
`TRIGGER:HAND_CLOSED_FIST`. They are not keyed by Swarmfall action names. Another host on the same
web origin can therefore reuse a compatible measurement, while still allowing the player to
retest.

Swarmfall's trigger UI offers a 6-prompt Quick Test and a 12-prompt Full Test. Both currently save
to the same profile slot, so saving a Quick Test replaces the previous result. The UI warns the
player. The full test is the intended comparison; the quick mode is a preview for development and
short demonstrations.

The comparison is deliberately conservative: a six-prompt Quick Test needs a two-prompt success
difference before that metric declares an advantage. One accidental activation remains visible
but does not decide the overall result by itself. Direction recommendations also use angular
error, jitter and dropout evidence.

Vision tuning is separate from task scores:

- Trigger response tuning steps down through candidate hold times and keeps a duration only after
  repeated detection and neutral-release checks.
- Pointing stability is recommended from observed landmark-loss gaps.
- `VisionDeviceSettingsController.measure()` probes the supported 10, 12 and 15 FPS rates, applies
  the fastest sustained rate and falls back to the lowest rate when none is sustained.

Apply saved tuning when constructing the vision channel. Treat it as device/context preference,
not as evidence that one input source outperformed another.

## 7. Manage camera lifecycle

Register platform channels with `ChannelManager`. After a binding changes, reconcile against
`adaptive.bindings.activeChannels()`:

```ts
await channels.reconcile(adaptive.bindings.activeChannels());
```

The manager serializes lifecycle changes, avoids duplicate starts and stops unused channels.
Camera denial or model failure must report an unavailable/error state while leaving touch usable.
Stopping vision must release the media stream and processing loop.

The camera preview is useful during calibration and gesture training. Swarmfall also renders a
small in-game mirror with MediaPipe hand connections so a demonstration can show the physical
gesture and mapped game response. That mirror is a host UI choice, not a package requirement.

The current recognizer processes one detected hand. Either hand can supply a pose, but handedness
does not create separate sources and simultaneous two-hand dispatch is not supported.

The reference web build self-hosts the pinned MediaPipe runtime and model at `/mediapipe/`, so
camera startup does not depend on a third-party runtime CDN.

## 8. Persist host bindings separately

The reusable calibration profile remembers how the player performed by task and source. The host
remains responsible for persisting its own action-to-source bindings because action names belong
to that game.

Validate persisted values before applying them. If a source is unavailable or no longer supported,
restore the declared touch default.

## Integration checklist

- The package does not import the host.
- Simulation code does not read pointer, touch or camera APIs.
- Every original touch capability remains available.
- Neutral channels never name host actions.
- Telemetry records before the binding check.
- Only the bound source dispatches.
- Continuous direction always has an explicit end.
- Previewing a binding does not mutate it.
- The player explicitly confirms or skips testing before a change.
- Reassigning an occupied global source returns the previous action to its touch default.
- Camera failure leaves touch playable.
- Repeated channel start/stop is safe.
- Saved vision timing and inference-rate values are validated before use.
- `npm run build` passes with strict TypeScript.

## Deliberately deferred

- Natural-language or LLM mapping
- Generated strategy or macro behaviour
- Button placement, size or offset modification
- Face, tilt, sound and custom-trained gesture channels
- Hand-specific or simultaneous two-hand bindings
- Cross-site account/profile synchronization
- Automatic conclusions about disability, fatigue or medical condition
