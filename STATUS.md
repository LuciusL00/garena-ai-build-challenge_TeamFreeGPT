# Project Status

**1 August 2026 · build until 8 Aug, submit 9 Aug**

Spec is in [PLAN.md](PLAN.md). This is just where we are and who does what.

---

## What we're building

A **game-agnostic middleware layer** that:

1. **Supplies input channels** — touch + on-device hand gesture, one interface. Games get
   alternative controls without building a camera pipeline or integrating a model.
2. **Assigns them per player** — measures how well you use each, recommends a better mapping,
   explains it, applies it on approval, checks it helped.

Swarmfall is the demo host, not the product.

> **Say "touch and hand gesture"** when describing what we provide. Face, tilt and sound are
> designed, not delivered.

---

## Where we are

| | |
|---|---|
| ✅ | Repo structure, submission doc skeletons |
| ✅ | Swarmfall playable |
| 🔄 | Git + private GitHub + collaborators |
| ⬜ | Swarmfall source into repo |

### Delivery tiers

Each tier demos on its own. We stop wherever the schedule lands.

| Tier | Contents | Status |
|---|---|---|
| **T0** | Swarmfall on the layer · calibration (touch + gesture) · recommender · live rebind · before/after | **must ship** — not started |
| **T1** | LLM primitive grammar — natural-language commands built from allowlisted parts | not started |
| **T2** | Second demo host — proves portability | conditional |
| **T3** | Extra gestures · face channel · advisory layout text | conditional |

---

## Timeline

| Date | What | Tier |
|---|---|---|
| **1 Aug** | Types merged. Swarmfall wired to `ActionBus` | T0 |
| 2–3 Aug | Touch + gesture channels. Calibration harness | T0 |
| 4–5 Aug | Recommender, live rebind, calibration + recommendation screens | T0 |
| 6 Aug | Before/after screen. T1 if clear | T0 / T1 |
| **7 Aug** | **Integration day.** Full flow end to end, repeatedly | — |
| 8 Aug | **Freeze at noon.** Record video, finalise deck, finish README + DISCLOSURE | — |
| 9 Aug | Submit. No code | — |
| 13 / 23 Aug | Finalists / final presentations | — |

**7 Aug is not a feature day.** Three people building in parallel will have integration problems.

---

## Work split

Channels parallelise. The pipeline does not.

```
ActionBus → Calibration → Scorer → Recommender → Before/After    ← serial, one owner
     ↑
TouchControls · GestureInput · (FaceInput)                       ← parallel, one each
```

| Role | Owns | Notes |
|---|---|---|
| **Core & Integration** | Swarmfall integration, bus + gating, calibration harness, recommender, live rebind | Needs familiarity with the Swarmfall codebase. Largest share, runs all week |
| **Vision Input & Screens** | `GestureInput` (MediaPipe), calibration + recommendation screens | Highest-risk single component — T0 fails without it |
| **Touch Input & Quality** | `TouchTelemetry`, `InputScorer`, results screen, tuning, device testing, demo script | Swarmfall's buttons already exist — this role instruments them, doesn't build them |

Everything is concurrent **after one merge** — the types with empty bodies. That is the only
blocking dependency in the project.

Deck content goes to whoever knows the thesis best; technical slides reviewed by Core. No single
role absorbs all three deliverables.

---

## First tasks

**Core & Integration** — Merge `GameAction`, `InputSourceId`, `ActionBus`, `BindingMap`,
`InputChannel` and the `InputScorer` output type, all with empty bodies. Push immediately; it
unblocks the other two roles. Then route Swarmfall's existing `LASSO` and `SWITCH_TYPE` through
the bus.

**Vision Input** — Read [ARCHITECTURE.md](ARCHITECTURE.md) §2–3. Then `GestureInput`: camera
permission, MediaPipe closed fist, confidence threshold, ~200 ms stability window, fire once,
handle denial.

**Touch Input** — `TouchTelemetry`: for each press on Swarmfall's existing buttons, record
landing position, duration, distance from centre, drift and repeat taps. The buttons already
exist; this instruments them.

---

## Decisions

Reasoning in [PLAN.md](PLAN.md) §2.

| Decision | Why |
|---|---|
| Inputs emit **abstract actions**; the game never sees taps or gestures | Makes remapping a one-line change instead of a rewrite |
| The **binding map gates dispatch**, not just config | Otherwise button and gesture both fire after a rebind |
| Measurement is a **cue-response task**, not in-game taps | A missed tap looks identical to no tap |
| The recommender **warns, never blocks** | Refusing to let players remap their own controls is paternalistic |
| The recommender is a **rule set**, not a trained model | It has to explain itself before changing your controls |
| The LLM **fills slots in a fixed schema** | Creativity from combining allowlisted parts, not from inventing game logic |
| **One vision model at a time** | Two on one camera stream will hurt frame rate on mid-range phones |

---

## Open items

| Item | By |
|---|---|
| Swarmfall source into repo | 1 Aug |
| Which gesture → which command | 3 Aug |
| Does T2 get built? | 5 Aug |
| LLM API access — awaiting Garena | 5 Aug |

---

## Submission checklist

Email `outreachsg@garena.com` with a Google Drive link, folder named after the team.
**Nothing may be modified after submitting.**

- [ ] **Deck** — PDF, max 15 slides: problem, users, solution, how AI contributes, impact,
      technical decisions
- [ ] **Code** — private GitHub repo, add `garena-ai-build-challenge` as collaborator. README,
      architecture overview, prompt configs, third-party disclosure. **No API keys**
- [ ] **Video** — max 5 minutes, complete flow end to end
- [ ] Repo link inside the Drive folder

**Judging:** Problem–Solution Fit 40% · Build Quality 30% · Originality 30%.

---

## Rules

- Branch per person, PR **merged same day**
- `git pull` on `main` before starting each day
- Never two people in one file
- Update [DISCLOSURE.md](DISCLOSURE.md) when you add a dependency
- Don't add scope because something finished early
