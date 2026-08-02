# Project Status

**2 August 2026 · build until 8 Aug, submit 9 Aug**

The specification is in [PLAN.md](PLAN.md). Private agent notes are not team
specifications. Swarmfall is the mobile-web demo host; the adaptive-input layer
is the product.

## Working rules

- Branch per person; review before merging to `main`.
- Pull `main` before starting new work.
- Never let two people own the same file.
- Import the middleware only through its public `src/index.ts` entry point.
- `packages/adaptive-input/` never imports from `demos/`.
- Add every dependency, model and API to [DISCLOSURE.md](DISCLOSURE.md).
- Do not add strategy generation, layout adaptation or native-app packaging to T0.

## T0 product scope

The layer:

1. Supplies web touch and on-device hand-gesture input behind one channel
   interface.
2. Lets a host declare typed game actions, their original controls, and whether
   each may be remapped.
3. Records accepted and rejected attempts before the binding gate.
4. Measures success rate, median cue-to-activation latency, and false
   activations for each channel.
5. Recommends an input mapping, explains the evidence, applies it only after
   approval, and validates the result.

The layer does **not** move individual game workers, inspect live game state,
generate strategies, execute macros, redesign buttons, or alter gameplay.

## Platform decision

- Demo: responsive mobile-first browser game deployed over HTTPS.
- Required test: at least one real phone, including camera denial and touch
  fallback.
- Current adapters: browser touch and browser MediaPipe.
- Native Unity, Android and iOS adapters: designed future work, not delivered.

## Current progress

| Status | Item |
|---|---|
| Complete | Personal Swarmfall prototype is playable and remains the fallback host |
| In review | Portable core skeleton: typed actions, defaults, binding gate, telemetry and lifecycle |
| External prototype | Vision teammate has camera/calibration code to submit for review |
| Pending | Team chooses the canonical Swarmfall implementation |
| Pending | Demo owner publishes the real action and payload table |
| Pending | Web touch and vision adapters integrate through the public channel contract |
| Pending | Calibration scorer, recommender, screens and before/after validation |

## Work split

| Owner | Owns | Must not own |
|---|---|---|
| **Core & Touch** | Public middleware contract, binding gate, telemetry, web touch adapter, scorer, recommender, final integration | Swarmfall mechanics or vision model internals |
| **Vision Input** | MediaPipe loading, camera permission, gesture stability/fire-once, confidence, channel start/stop, vision calibration integration | Swarmfall actions, binding rules or game behaviour |
| **Demo Host** | Canonical Swarmfall mechanics, action/payload table, game-side adapter, responsive mobile-web UI, real-phone gameplay testing | Middleware core, camera detection or input recommendation policy |

The demo owner should work on `demo/coder-swarmfall` until the team selects and
reviews that candidate. The existing `main` demo remains recoverable.

## Immediate handoffs

### Core & Touch

1. Merge the reviewed portable skeleton.
2. Publish the public interfaces and usage notes.
3. Review the vision source against `InputChannel`.
4. Obtain the canonical demo's action table before writing game-specific wiring.
5. Implement the web touch adapter and mapping-only scorer.

### Vision Input

Provide source code, dependency/model details, run instructions and known gaps.
The reusable channel emits only:

```text
source · monotonic timestamp · confidence · optional measurement session/phase
```

It must fire once per held gesture, require release before refiring, stop the
camera cleanly, and leave touch playable when permission is denied.

### Demo Host

Provide:

```text
action name · payload shape · existing game effect · fixed/remappable
```

The host adapter translates approved actions into existing game behaviour. The
middleware never emits per-worker movement instructions.

## Delivery ladder

| Tier | Contents | Status |
|---|---|---|
| **T0** | One discrete live rebind, touch + gesture calibration, recommendation, approval, before/after, mobile HTTPS demo | Must ship |
| **T1** | Additional allowlisted mappings and explanation/mobile polish | Conditional |
| **T2** | Second host proving portability | Conditional |
| **T3** | Extra gesture, face or tilt channels | Conditional |

Natural-language mapping is deferred until T0 is reliable. It may later select
an allowlisted mapping ID; it will not generate strategy or executable logic.

## Verification required for every handoff

- Run `npm run check:adaptive` for middleware work.
- Run `npm run build` for every repository change.
- Paste actual output; label anything not tested as `UNVERIFIED`.
- List every changed file.
- No secrets, `.env` files, ZIP archives, `node_modules` or generated build
  folders in commits.

## Submission checklist

- Deck PDF, maximum 15 slides.
- Source repository with architecture, setup and disclosure documentation.
- Video, maximum five minutes, showing the complete flow on a real device.
- HTTPS demo URL.
- Final Google Drive submission on 9 August; no post-submission edits.
