# Architecture

> Status: design settled, implementation in progress. Sections marked **TODO** are completed as
> the corresponding component lands.

## 1. Overview

The layer has two responsibilities:

1. **Supplying input channels.** Touch controls and on-device hand gesture recognition are
   implemented inside the layer, not inside any host game. A game adopting the layer gets these
   channels without building a camera pipeline or integrating a model. The `InputChannel`
   interface is designed to accept further channels (face blendshapes, device tilt, sound);
   those are designed, not delivered.
2. **Assigning channels to actions.** It measures per-player channel performance, recommends
   a mapping, explains it, and applies it on approval.

The system separates **input sources** from **game actions**. Nothing in game simulation reads a
pointer, a hand landmark or a sensor value directly. Channels emit neutral `InputSignal` records;
a host-owned adapter translates them into the host's declared action and typed payload. A binding
map decides whether that source currently drives the action, and the map can change at runtime.

That indirection is the entire product. Moving an action from a touch button to a hand gesture
is a one-line map mutation, not a code change. Because every channel is owned by the layer, it
can also guarantee capability parity across them — every action reachable by gesture is
reachable by touch.

```
packages/adaptive-input/     the layer   ─┐
                                          ├─ one-way dependency
demos/swarmfall/                  host ─┘
```

The layer never imports from a host. Hosts import the layer.

---

## 2. Data flow

```text
TouchInput ───┐
GestureInput ─┴─► InputSignal (trigger, point, or direction + metadata)
                         │
                         ▼
              host adapter supplies action + typed payload
                         │
                         ├────► TelemetryRecorder (PRE-GATE)
                         ▼
              BindingMap.get(action) === signal.source ?
                         │
                  no ────┴──── yes
                  │             │
                  ▼             ▼
         log as rejected   dispatch to host listener
```

Two invariants that are easy to break:

1. **The gate is on dispatch, never on recording.** Telemetry taps the stream *before* the
   binding check, so an unbound source keeps being measured. This is what makes the
   before/after comparison possible.
2. **Rejected emissions are recorded, not discarded.** A player reaching for the old touch
   button after a rebind is real habit-persistence data.

---

## 3. Key interfaces

### Actions and requirements

Games declare what their actions need. The layer measures what the player can do. The
recommender matches the two.

```ts
interface ActionRequirements {
  spatial: boolean;          // needs precise continuous positioning
  latencyCritical: boolean;  // does not tolerate added input latency
}

interface ActionDescriptor {
  id: string;
  requirements: ActionRequirements;
  defaultSource: InputSourceId; // original game control
  remappable: boolean;           // false keeps that original control
}
```

These drive **warnings, not blocks**. An action whose requirements a channel serves poorly is
not recommended for that channel, and if the player moves it anyway they are shown the measured
cost first. The player always decides.

### Sources vs channels

Two distinct concepts:

- **`InputSourceId`** — an individual bindable signal (`TOUCH_ABILITY`, `HAND_CLOSED_FIST`).
  This is what `BindingMap` binds.
- **`InputChannelId`** — the lifecycle owner (`TOUCH`, `HAND_VISION`, `FACE_VISION`). One
  channel provides several sources. A channel starts when any of its sources is bound and stops
  when none are.

The channel concept exists because vision models are expensive: **only one vision model runs at
a time**, whichever channel currently owns a bound source.

### Typed payloads

Continuous and discrete actions need different game payloads. Source metadata remains separate
from those payloads so the host game does not learn which input implementation produced them.

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

---

## 4. Measurement

Ground truth for player *intent* cannot be inferred from in-game input — a missed tap is
indistinguishable from no tap. Measurement therefore uses a **prompted cue-response task**:
a cue appears after a random delay, the player responds on the channel under test, and the
outcome and timing are recorded.

**Latency is defined identically for every channel:** cue onset → action activation, in
milliseconds. Vision channels include a stability window and will generally measure *slower*
than touch. That is the real result, and it is what the recommender exists to arbitrate against
reliability.

**TODO** — metric definitions, adaptive trial count, false-activation window.

---

## 5. Recommendation

A transparent rule set, not a trained model. Explainability is a requirement, not a limitation:
the product must justify its recommendations to the player before applying them.

The recommender combines *declared* action requirements with *measured* channel capabilities. An
action marked `spatial` or `latencyCritical` is not recommended for a channel that serves it
poorly — but the player may override, and is shown the quantified cost before doing so:

> *"Lasso accuracy: 91% on touch, 64% on gesture. Precision will drop. Move it anyway?"*

The system informs; the player decides. Blocking a player from remapping their own controls
would be the wrong posture for a product whose premise is that the player understands their own
needs better than the game does.

**TODO** — rule set, thresholds, explanation templates.

---

## 6. AI components

| Component | Role | Runs |
|---|---|---|
| MediaPipe Tasks Vision | On-device gesture / face recognition | In-browser, on-device |
Natural-language mapping is deferred. If added later, a model may select an allowlisted mapping
ID only; it will not generate strategies, gameplay code, payloads or timed command sequences.

---

## 7. Privacy

Recognition runs on-device. Raw camera frames never leave the browser. Only derived metrics
persist, in local storage.
