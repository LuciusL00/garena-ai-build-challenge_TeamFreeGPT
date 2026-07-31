# Adaptive Input Layer

**Garena AI Build Challenge 2026 — Reimagine Digital Entertainment Experiences**

Mobile games let players move and resize buttons, but the player still has to adapt to the
touchscreen. Players differ in hand size, motor ability, grip, fatigue, reach and reaction time.
Input channels differ too — touch is fast but hard to reach, a gesture is slower but steadier,
face movement works when both hands are occupied.

This project is a **game-agnostic middleware layer** that does two things.

### 1. It provides the input channels

Touch controls and on-device hand gesture recognition, behind one uniform interface. **A game
adopting the layer gets alternative controls without implementing any of them.** No camera
pipeline to build, no model to integrate, no per-channel plumbing.

The same `InputChannel` interface is designed to take further channels — face blendshapes,
device tilt, sound. Those are designed, not delivered.

### 2. It assigns them to actions, per player

1. **Measures** how reliably this individual player uses each available channel.
2. **Compares** those measurements against each game action's declared requirements.
3. **Recommends** which action should move to which channel.
4. **Explains** the recommendation in plain language.
5. **Validates** whether the new configuration actually improved performance.

> **Declared action requirements × measured input capabilities → assignment, with an explanation.**

The layer knows nothing about any particular game. Games declare their actions and requirements;
the layer supplies the channels and handles measurement, recommendation and rebinding.

---

## Repository layout

```text
packages/
└── adaptive-input/     the product — input abstraction, telemetry,
                        calibration, recommendation engine

demos/
├── swarmfall/          host 1 — real-time swarm control game
└── survivor/           host 2 — top-down survivor (portability demonstration)
```

**Rule:** `packages/adaptive-input/` must never import from `demos/`. The dependency runs one
way only. That constraint is what makes the portability claim verifiable rather than asserted.

---

## Integration surface

What a game developer writes to adopt the layer:

```ts
// Turn on the channels this game wants available.
// Touch controls, gesture recognition and the camera pipeline all come from the layer.
adaptive.enableChannels(['TOUCH', 'HAND_VISION']);

// Declare what each action needs. The layer works out the rest.
adaptive.registerActions([
  { id: 'LASSO',  requirements: { spatial: true,  latencyCritical: false } },
  { id: 'RECALL', requirements: { spatial: false, latencyCritical: false } },
  { id: 'HOLD',   requirements: { spatial: false, latencyCritical: false } },
]);

adaptive.on('RECALL', () => swarm.recall());
```

That is the entire integration. The game never touches a pointer event, a hand landmark or a
camera stream — and calibration, measurement, recommendation and rebinding are all handled by
the layer.

---

## Setup

> **TODO** — complete before submission. Must allow a reviewer to run the prototype from a
> clean checkout.

**Requirements**

- Node.js 22+
- A device with a camera, for gesture input
- HTTPS (camera access requires a secure context — see Deployment)

**Install**

```bash
# TODO
```

**Run a demo**

```bash
# TODO
```

**Deployment**

Camera access requires a secure context. Local development over `http://localhost` works;
LAN access over plain HTTP does not. For device testing, use the deployed HTTPS URL.

- Live demo: **TODO**

---

## Documentation

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, data flow, key interfaces |
| [DISCLOSURE.md](DISCLOSURE.md) | Third-party libraries, models, datasets and APIs |
| [PLAN.md](PLAN.md) | Implementation plan and decision log |

---

## Privacy

Alternative-input recognition runs entirely **on-device**. Raw camera frames are never
transmitted, stored, or sent to any server. Only derived metrics — success rates, latencies,
confidence scores — are retained, and only in browser local storage.
