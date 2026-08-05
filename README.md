# Adaptive Input Layer

**Garena AI Build Challenge 2026 — Reimagine Digital Entertainment Experiences**

Mobile games usually let players move or resize controls, but the player still has to adapt to
the available input. This project is game-agnostic middleware that lets an integrating game offer
touch and on-device hand input through one typed boundary.

For each player, the layer can:

1. Measure compatible input sources with the same prompted task.
2. Compare success, reaction latency and false activations.
3. Explain whether one input measured better or whether the result is a trade-off.
4. Apply a new binding only after the player approves it.
5. Keep the game's original touch control available as the safe default.

MediaPipe gesture recognition runs in the browser. Raw camera frames are not uploaded or stored.
The current MVP uses transparent comparison rules rather than an LLM.

## Live demo

[Play Swarmfall](https://swarmfall-adaptive-demo.meiyi-li-2025.chatgpt.site)

Swarmfall is the reference host, not the product. Its remappable actions are Gather, Spread,
Switch squad and Direct units. Touch provides every original action; closed fist, open palm,
thumbs up and hand-point direction are compatible alternatives.

The calibration page offers:

- **Quick Test — 6 prompts:** a preview for development and short demonstrations.
- **Full Test — 12 prompts:** the intended trigger-input comparison.
- **Direction Test — 8 prompts:** compares touch direction with hand pointing.

Quick and Full trigger tests currently save to the same task-and-source profile slot. Running a
Quick Test after a Full Test replaces that saved result; the UI states this explicitly.

## Run locally

Requirements:

- Node.js 22 or newer
- npm
- A camera for visual input; touch remains usable without one

```powershell
npm install
npm run dev
```

Open `http://localhost:3000/`. Browsers treat localhost as a secure context, so camera access can
work there. A phone cannot normally use the laptop's plain-HTTP LAN address for camera testing;
use the public HTTPS demo instead.

Verify a production build:

```powershell
npm run build
npm run start
```

## Repository layout

```text
packages/
└── adaptive-input/     reusable middleware: actions, bindings, channels,
                        telemetry, calibration, profiles and recommendation

demos/
└── swarmfall/          reference host game and host-owned adapter/UI

app/
├── page.tsx            Swarmfall web route
└── calibration/        web calibration screen used by the reference host
```

`packages/adaptive-input/` never imports from `demos/`. A host imports the layer and translates
neutral input signals into its own typed game actions.

## Integration at a glance

```ts
interface GameActions {
  GATHER_UNITS: Record<string, never>;
  DIRECT_UNITS: { direction: { x: number; y: number } | null };
}

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

adaptive.on('GATHER_UNITS', () => game.gatherSelectedUnits());
adaptive.on('DIRECT_UNITS', ({ direction }) => game.directSelectedUnits(direction));
```

Input channels emit neutral signals containing a source, timestamp, input shape and optional
confidence. A host adapter chooses the matching game action and payload. `BindingMap` then decides
whether that source may dispatch the action, while telemetry records both accepted and rejected
attempts.

See [packages/adaptive-input/INTEGRATION.md](packages/adaptive-input/INTEGRATION.md) for the complete
host contract.

## Documentation

Read these in this order:

| Document | Purpose |
|---|---|
| [STATUS.md](STATUS.md) | Current implementation, ownership, known gaps and handoff state |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Current system boundaries and data flow |
| [PLAN.md](PLAN.md) | Initial planning baseline plus a record of what changed |
| [DISCLOSURE.md](DISCLOSURE.md) | Libraries, models, runtime downloads and external services |
| [CONSIDERATIONS.md](CONSIDERATIONS.md) | Assumptions and design questions; some entries are historical |

When a historical PLAN statement conflicts with STATUS, ARCHITECTURE or the code, the current
documents and code win.

## Current scope

Shipped:

- Touch trigger and directional sources
- On-device closed fist, open palm, thumbs up and hand-point direction
- Typed action registration and runtime binding gate
- Pre-gate telemetry
- Trigger and direction calibration
- Saved player profile, side-by-side comparison and explicit binding approval
- Camera failure fallback to touch

Deferred:

- Face, tilt, sound and custom-trained gesture channels
- Natural-language mapping and LLM integration
- Generated strategies, macros and executable behaviour
- Automatic button-layout modification
- Cross-site account/profile synchronisation

## Privacy and limitations

Camera processing stays on the player's device. The browser stores derived calibration scores and
bindings in local storage. The MediaPipe WebAssembly runtime and published gesture model are
downloaded from the pinned URLs listed in [DISCLOSURE.md](DISCLOSURE.md).

Saved measurements describe one device and testing context. Lighting, grip, camera angle or the
player's condition may later change, so the player can retest instead of treating an old result as
permanent truth.
