# Adaptive Input Layer

**Garena AI Build Challenge 2026 — Reimagine Digital Entertainment Experiences**

> **Games should adapt to players—not force players to adapt to controls.**

Mobile games are commonly built around fixed touch controls. When alternative inputs exist, they
are often custom-built for one title, designed around cursor or keyboard primitives, or manually
configured without helping the player determine what works best.

| Existing approach | Strength | Gap |
|---|---|---|
| Game-native accessibility controls | Directly understand game actions | Rebuilt separately for every game |
| OS/PC-facing alternative controllers | Work across multiple applications | Usually expose cursor, click or key primitives rather than game semantics |
| Manual remapping | Gives players choice | Leaves the player to discover suitable mappings through trial and error |
| Adaptive Input | Reusable, game-semantic middleware | Requires each game to provide a small action adapter |

Alternative input is not enough. Players need help finding which available input best fits each
action, device and context.

## Who it is for

- **Primary users:** mobile players whose preferred input varies with reach, grip, reaction speed,
  fatigue, motor ability or playing context.
- **Integrators:** game developers, designers and accessibility teams that connect their game
  actions to the middleware.
- **Organizational stakeholders:** studios and publishers that may reuse the same input
  infrastructure across multiple titles.

The rest of this documentation uses **game teams** as the umbrella term for the people integrating
and maintaining the layer.

## What it does

For each player, the layer can:

1. Measure compatible input sources with the same prompted task.
2. Compare success, response time, false activations and directional quality where relevant.
3. Recommend a per-action mapping and explain the measured evidence or trade-off.
4. Leave the decision with the player: approve, reject, skip testing or restore touch.
5. Validate the accepted binding through normal gameplay.

MediaPipe gesture recognition runs on-device in the browser. Raw camera frames are not uploaded or
stored. The recommender uses transparent comparison rules rather than an unsupported trained model
or LLM.

Expected benefits are less player trial and error, more reliable access to game actions, and less
repeated input and computer-vision work for game teams. These are prototype goals, not clinical
accessibility or adoption claims.

## Live experience

- [Play Swarmfall](https://luciusl00.github.io/)
- [Open the independent portability host](https://luciusl00.github.io/portability)
- [Try the open-source 2048 portability host](https://luciusl00.github.io/portability-2048)

The small Pulse host proves that a typed action can be registered without importing Swarmfall.
The 2048 host goes one step further: it keeps a pinned MIT-licensed game's grid, movement and
rendering logic unchanged, then connects touch and hand direction through one semantic
`MOVE_TILES` adapter. The project does not claim authorship of 2048; its source and licence are
preserved under `public/2048/`.

Swarmfall is the reference host, not the product. Its six remappable actions are:

- Gather units
- Spread units
- Switch squad
- Direct units
- Miner Protect
- Guard Escort

Every action retains its original touch path. Closed fist, open palm and thumbs up provide
one-shot alternatives; hand pointing provides relative direction. Begin and Restart remain fixed
touch actions.

The calibration experience includes:

- **Quick Test — 6 prompts:** a short preview for development and demonstrations.
- **Full Test — 12 prompts:** the intended trigger-input comparison.
- **Direction Test — 8 prompts:** compares touch direction with hand pointing.
- **Response tuning:** finds a reliable hold time independently for each trigger pose.
- **Pointing stability:** recommends dropout tolerance from observed pointing gaps.
- **Camera-rate test:** measures 10, 12 and 15 FPS and saves the fastest sustained rate, falling
  back to the lowest rate if none is sustained.

Quick and Full tests intentionally share one profile slot in this prototype. Saving a Quick Test
therefore replaces a previous Full Test result; the UI warns the player before use.

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
work there. A phone cannot normally use a laptop's plain-HTTP LAN address for camera testing; use
an HTTPS deployment instead.

Verify and run a production build:

```powershell
npm run build
npm run start
```

## Repository layout

```text
packages/
└── adaptive-input/     reusable actions, bindings, channels, telemetry,
                        calibration, profiles, tuning and recommendation

demos/
├── swarmfall/          reference game and host-owned adapter/UI
└── 2048-portability/   semantic adapter for the pinned open-source game logic

app/
├── page.tsx            Swarmfall route
├── calibration/        prompted measurement and vision tuning
├── portability/        independent one-action host proving the package boundary
└── portability-2048/   open-source-game portability smoke test
```

`packages/adaptive-input/` never imports from `demos/`. Input channels emit neutral signals; a
host adapter supplies game meaning and typed payloads. `BindingMap` gates dispatch while telemetry
records both accepted and rejected attempts before that gate.

## Integration at a glance

```ts
interface GameActions {
  GATHER_UNITS: Record<string, never>;
  SPREAD_UNITS: Record<string, never>;
  TOGGLE_SQUAD: Record<string, never>;
  DIRECT_UNITS: { direction: { x: number; y: number } | null };
  TOGGLE_MINER_PROTECT: Record<string, never>;
  TOGGLE_GUARD_ESCORT: Record<string, never>;
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

See [the integration guide](packages/adaptive-input/INTEGRATION.md) for the complete host contract.

## Documentation

| Document | Purpose |
|---|---|
| [STATUS.md](STATUS.md) | Current shipped state, verified evidence and remaining limitations |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Current boundaries, data flow, AI role and portability design |
| [packages/adaptive-input/INTEGRATION.md](packages/adaptive-input/INTEGRATION.md) | Host integration contract |
| [DISCLOSURE.md](DISCLOSURE.md) | Third-party libraries, model assets and hosted services |
| [AGENTS.md](AGENTS.md) | Active engineering rules and agent configuration |
| [docs/archive/](docs/archive/) | Historical competition planning, assumptions and teammate guidance |

The archive preserves how the team reached the MVP. It is not current specification or process
guidance.

## Current scope

Shipped:

- Typed semantic actions, original touch defaults and runtime binding gate
- Touch trigger/direction and on-device closed fist, open palm, thumbs up and hand-point direction
- Prompted trigger and direction measurement with conservative, explained recommendations
- Explicit approval, override, conflict handling, default restoration and local persistence
- Per-pose hold tuning, pointing stability and automatic camera-rate selection
- In-game gesture mirror with hand landmarks and mapped-action feedback
- Camera failure fallback to touch
- Responsive mobile portrait and landscape gameplay
- Independent Pulse and open-source 2048 portability hosts with no Swarmfall imports

Deferred:

- Face, tilt, sound and custom-trained gesture channels
- Natural-language mapping and LLM integration
- Generated strategies, macros or executable behavior
- Hand-specific or simultaneous two-hand bindings
- Automatic button-layout modification
- Cross-site account/profile synchronization

## Privacy, evidence and limitations

The pinned MediaPipe WebAssembly runtime and published Gesture Recognizer model are served from
the application's own assets listed in [DISCLOSURE.md](DISCLOSURE.md). Camera processing stays on
the player's device; browser storage contains only derived measurements, tuning and bindings.

The recognizer accepts either hand but processes one detected hand at a time. A phone may be
supported or held in one hand while the other gestures. The MVP does not distinguish left-hand
from right-hand bindings.

Testing so far was performed by the development team, not a formal user study. On one manually
tested phone, the default camera processing rate caused visible lag and no visible lag was
observed after automatic rate selection. That observation is device-specific and not a controlled
performance benchmark.

Saved measurements describe one player, device and testing context. Lighting, grip, camera angle
or the player's condition may change, so the player can retest rather than treating an old result
as permanent truth.
