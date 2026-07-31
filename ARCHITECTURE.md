# Architecture

> Status: design settled, implementation in progress. Sections marked **TODO** are completed as
> the corresponding component lands.

## 1. Overview

The system separates **input sources** from **game actions**. Nothing in a host game ever reads
a pointer, a hand landmark or a sensor value directly. Input sources emit abstract actions; the
game listens for them. A binding map decides which source currently drives which action, and
that map can be changed at runtime.

That indirection is the entire product. Moving an action from a touch button to a hand gesture
is a one-line map mutation, not a code change.

```
packages/adaptive-input/     the layer   ─┐
                                          ├─ one-way dependency
demos/swarmfall/  demos/survivor/   hosts ─┘
```

The layer never imports from a host. Hosts import the layer.

---

## 2. Data flow

```
TouchControls ─┐
GestureInput  ─┼─► ActionBus.emit(action, { source, timestamp, ... })
FaceInput     ─┘
                        │
                        ├──────────────► TelemetryRecorder   (PRE-GATE — records every
                        │                                     emission from every source,
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
                     host game handles the action
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
  spatial: boolean;          // needs precise continuous positioning — not remappable
  latencyCritical: boolean;  // must not tolerate added input latency
}
```

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

Continuous actions carry a vector; discrete actions carry a confidence score. A single loose
payload type cannot serve both.

```ts
type Payload<A extends GameAction> =
  ActionPayloadMap[A] & { source: InputSourceId; timestamp: number };

emit  <A extends GameAction>(action: A, payload: Payload<A>): void;
listen<A extends GameAction>(action: A, fn: (p: Payload<A>) => void): void;
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
action marked `spatial` or `latencyCritical` is never moved off touch, regardless of how well
the player performs on an alternative channel — and the refusal is stated explicitly.

**TODO** — rule set, thresholds, explanation templates.

---

## 6. AI components

| Component | Role | Runs |
|---|---|---|
| MediaPipe Tasks Vision | On-device gesture / face recognition | In-browser, on-device |
| LLM (constrained schema) | Interprets player constraints; composes tactical presets from an allowlisted primitive grammar | Server-side function, between rounds |

The LLM never enters the real-time loop, never generates gameplay code, and never emits
free-form output. It fills slots in a fixed schema whose values are validated against an
allowlist server-side before reaching any game.

**TODO** — prompt configurations, schema definitions, validation rules.

---

## 7. Privacy

Recognition runs on-device. Raw camera frames never leave the browser. Only derived metrics
persist, in local storage.
