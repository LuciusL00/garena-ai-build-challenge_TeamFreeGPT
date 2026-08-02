# Integrating a host game

This is the contract for a future host integration. It has **not** been applied
to Swarmfall yet. The team's canonical demo and action table must be agreed
before game-specific wiring is merged.

## The three boundaries

```text
platform input        host translation       game behaviour
touch / gesture  ->   action + payload   ->  existing game listener
       |                       |
       +-> neutral signal      +-> AdaptiveInput records, gates, dispatches
```

- A channel reports an `InputSignal`: source, timestamp, and optional
  confidence. It never imports a game or names a game action.
- A host adapter translates that signal into one of the host's declared actions
  and its typed payload.
- `AdaptiveInput` records the attempt before checking whether that source is
  currently bound. Only accepted attempts reach game logic.

The layer never sends worker coordinates, chooses targets, reads live game
state, or generates command sequences. Those are game responsibilities.

## Declare original controls

The host declares every action that passes through the layer. Original controls
are installed immediately, so adopting the package does not remove working
touch input.

```ts
interface HostActions {
  BEGIN_ROUND: Record<string, never>;
  RESTART_ROUND: Record<string, never>;
  TOGGLE_SQUAD: Record<string, never>;
}

const adaptive = new AdaptiveInput<HostActions>();

adaptive.registerActions([
  {
    id: 'BEGIN_ROUND',
    requirements: { task: 'TRIGGER', spatial: false, latencyCritical: false },
    defaultSource: InputSourceId.TOUCH_BUTTON,
    remappable: false,
  },
  {
    id: 'RESTART_ROUND',
    requirements: { task: 'TRIGGER', spatial: false, latencyCritical: false },
    defaultSource: InputSourceId.TOUCH_BUTTON,
    remappable: false,
  },
  {
    id: 'TOGGLE_SQUAD',
    requirements: { task: 'TRIGGER', spatial: false, latencyCritical: false },
    defaultSource: InputSourceId.TOUCH_BUTTON,
    remappable: true,
  },
]);
```

`TOGGLE_SQUAD` above is an integration example, not an instruction to add that
exact action. The demo owner must provide the real action table first.

`BEGIN_ROUND` and `RESTART_ROUND` remain fixed touch controls. Calling
`adaptive.rebind()` for either throws instead of silently breaking the game's
fallback. A game may explicitly declare another action remappable when it wants
to offer that choice.

## Translate without coupling the channel to the game

The vision implementation emits only a neutral signal:

```ts
context.emit({
  source: InputSourceId.HAND_CLOSED_FIST,
  kind: 'trigger',
  timestamp: performance.now(),
  confidence: 0.92,
});
```

`task` describes only the neutral input shape: `TRIGGER`, `DIRECTION`, or `POINT`. Calibration
scores are stored by task and input source, so one recent touch-trigger score can support several
button-like actions without teaching the middleware what those actions mean in the game.

The host-owned adapter supplies the action and payload:

```ts
function handleSignal(signal: InputSignal): void {
  if (signal.source === InputSourceId.HAND_CLOSED_FIST) {
    adaptive.emitFrom('TOGGLE_SQUAD', {}, signal);
  }
}
```

The adapter may report candidate attempts from both touch and gesture. The
binding gate decides which one dispatches, while telemetry retains both.
Changing the accepted source is one checked call:

```ts
adaptive.rebind('TOGGLE_SQUAD', InputSourceId.HAND_CLOSED_FIST);
```

One source may legitimately back several actions. For example,
`TOUCH_BUTTON` can remain the default for Begin, Restart, and menu commands.
Never implement a global "one source may appear only once" rule.

Directional pointing is also a neutral signal:

```ts
context.emit({
  source: InputSourceId.HAND_POINT_DIRECTION,
  kind: 'direction',
  direction: { x: 0.8, y: -0.2 },
  timestamp: performance.now(),
  confidence: 0.88,
});
```

This does not move a game unit by itself. A host may translate it to a declared
relative-movement action only when the game already implements that action and
offers an equivalent touch source such as `TOUCH_DIRECTION`. Otherwise the
gesture would add a new capability instead of adapting an existing control.

## Forward actions explicitly

Use typed listeners rather than a loop containing `as never` casts:

```ts
adaptive.on('BEGIN_ROUND', (payload) => gameBus.emit('BEGIN_ROUND', payload));
adaptive.on('RESTART_ROUND', (payload) => gameBus.emit('RESTART_ROUND', payload));
adaptive.on('TOGGLE_SQUAD', (payload) => gameBus.emit('TOGGLE_SQUAD', payload));
```

This is repetitive by a few lines, but action names and payload mistakes are
caught by TypeScript.

## Channel lifecycle

Register platform channels with `ChannelManager`. After a binding change,
reconcile it with `adaptive.bindings.activeChannels()`:

```ts
await channels.reconcile(adaptive.bindings.activeChannels());
```

The manager serializes changes, starts only required channels, stops unused
ones, and reports failures. Camera denial must leave the fixed touch controls
playable.

## Deliberately deferred

- Swarmfall integration, until the team chooses its canonical demo.
- Vision prototype adaptation, until its source is reviewed.
- Natural-language or LLM mapping.
- Strategy generation.
- Button layout, touch offset, drift, and directional-bias adaptation.
- A continuous `LASSO_POINT` storage policy. Until aggregation is implemented,
  do not use high-frequency point records as recommendation evidence.
