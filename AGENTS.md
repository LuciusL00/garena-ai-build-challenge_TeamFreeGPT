# Agent Instructions

Read this before making any change. It applies to every coding agent working in this repository
(Codex, Claude Code, or otherwise).

---

## Project

A game-agnostic middleware layer that supplies input channels (touch, on-device hand gesture) and
assigns them to game actions per player — measuring, recommending, explaining, and validating.
`demos/swarmfall/` is a demo host, not the product. See [PLAN.md](PLAN.md) for the specification.

---

## Non-negotiable architecture rules

Breaking any of these silently breaks the product. If a task seems to require it, **stop and ask**.

1. **`packages/adaptive-input/` must never import from `demos/`.** The dependency runs one way
   only. This is what makes the portability claim verifiable.
2. **Game code must never read pointer, touch or camera APIs directly.** All input goes through
   `ActionBus` as abstract actions.
3. **`BindingMap` gates dispatch, not just configuration.** An action reaches listeners only if the
   emitting source is currently bound to it.
4. **Telemetry hooks run *before* the binding check.** Unbound sources must still be recorded —
   that is what produces the before/after comparison. Rejected emissions are logged, not discarded.
5. **HUD positions come from `ui/layout.ts`. Tuning numbers come from `config/balance.ts`.** No
   hardcoded coordinates or magic numbers elsewhere.

---

## Workflow — every task, no exceptions

1. **Inspect the relevant files first.** Do not propose changes to code you have not read.
2. **State the plan before editing.** For anything touching more than two files, wait for approval.
3. **Change only what the task requires.**
4. **Run `npm run build` and paste the actual output.**
5. **List every file you changed.**
6. **Stop.** Do not begin the next task, and do not implement future tiers early.

---

## Honesty requirements

These exist because unverified claims are worse than no work at all — they cost more time to
discover than the task saved.

- **If you did not run a command, say so.** Never describe output you did not see.
- **If something failed, report the failure and the exact error text.** Do not summarise it as
  "minor issues" or work around it silently.
- **If you are not sure a change works, label it `UNVERIFIED` explicitly.**
- **Never claim a test passes without pasting its output.**
- **If the task is ambiguous, ask.** A question costs a minute; a wrong guess costs an hour.
- **If you could not complete part of the task, say which part and why.** Partial work reported
  honestly is useful. Partial work reported as complete is a trap.

---

## Do not

- Add dependencies without explaining why and getting approval
- Refactor or "improve" code unrelated to the task
- Create files that were not asked for
- Add `any`, `@ts-ignore`, or weaken `strict` to make an error go away — fix the actual type
- Delete, skip or bypass a failing test
- Modify another role's directory (see [STATUS.md](STATUS.md) for ownership)

---

## Conventions

- TypeScript `strict: true`. No `any`.
- Prefer editing an existing file over creating a new one.
- **Update [DISCLOSURE.md](DISCLOSURE.md) whenever you add a dependency, model or API.** This is a
  submission requirement, not housekeeping.
- Never commit API keys, `.env` files, or credentials.

---

## Task template

Tasks given to an agent should look like this:

```text
CONTEXT:    packages/adaptive-input/input/
TASK:       Implement GestureInput: MediaPipe closed-fist detection emitting
            through ActionBus.
CONSTRAINTS: Do not modify ActionBus or BindingMap. Do not touch demos/.
DONE WHEN:  A detected fist held ~200ms emits exactly once and does not
            re-fire until the hand opens. Camera denial leaves the game playable.
VERIFY:     Run `npm run build`, paste the output. Describe how you tested
            the fire-once behaviour, or state that you could not test it.
```

The `DONE WHEN` and `VERIFY` lines are the important ones. A task without a checkable
finish condition will be reported as finished regardless of its state.
