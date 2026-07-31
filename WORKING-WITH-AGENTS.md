# Working With Coding Agents

**For the team.** [AGENTS.md](AGENTS.md) is instructions *to* the agent — it reads that file
automatically. This file is for the people driving it.

Nobody needs to read this end to end. The first two sections are the ones that matter.

---

## The one principle

> **Never accept a claim. Only accept evidence.**

Coding agents report work as finished whether or not it is. This is not a quirk of one product —
it happens across all of them, and it is the single biggest source of wasted time.

The fix is not a better model. The fix is **never being in a position where a claim matters.**

Instead of asking *"did it work?"*, say:

> **"Run `npm run build` and paste the output."**

If it cannot paste real output, it did not run the command. Fabricated terminal output is far
rarer than fabricated prose summaries, and it is obvious when it happens because the formatting
is wrong.

---

## Five habits

### 1. Put a finish condition in every task
A task without a checkable finish condition will be reported as finished regardless of its state.
This is the highest-value habit on the list.

```text
DONE WHEN: a fist held ~200ms emits exactly once and does not re-fire
           until the hand opens
VERIFY:    run `npm run build`, paste the output. Describe how you tested
           fire-once, or state that you could not test it.
```

That last clause matters. **Explicitly allow "I couldn't test this."** Agents overclaim partly
because failure feels disallowed. Give it a legitimate way to say *unverified* and you get honesty
far more often.

### 2. Ask for the plan before the edits
> *"Tell me what you'll change and why. Don't edit yet."*

Catches wrong-direction work while it is still free, and catches a misread of the task before it
becomes a revert.

### 3. One task, one file, one behaviour
Long tasks are exactly where instructions get dropped. Three small requests beat one large one,
every time.

### 4. Commit before, diff after
Never let an agent work on a dirty tree — you lose the ability to tell its changes from yours.

```powershell
git add -A; git commit -m "before agent work"
# ...let the agent work...
git diff                 # your review
git checkout .           # your undo, if needed
```

### 5. Read every diff before accepting it
Non-negotiable. If you did not read it, you did not review it.

---

## Prompt structure

```text
CONTEXT:     which files or area
TASK:        one specific thing
CONSTRAINTS: what not to touch
DONE WHEN:   checkable finish condition
VERIFY:      the command to run, and paste real output
```

Worked example:

```text
CONTEXT:     packages/adaptive-input/input/
TASK:        Implement TouchTelemetry — record landing position, duration,
             distance from button centre, drift, and repeat taps.
CONSTRAINTS: Do not modify ActionBus or BindingMap. Do not touch demos/.
DONE WHEN:   Every press on an instrumented button produces one sample
             with all five fields populated.
VERIFY:      Run `npm run build` and paste the output. Show me the sample
             object produced by one real press, or say you could not test it.
```

The template also lives in [AGENTS.md](AGENTS.md), so nobody has to memorise it.

---

## If you have never used one before

Four things, in order of importance.

**1. It is a fast junior who never says "I don't know."**
Treat every output as a draft from someone confident regardless of whether they are right. Speed
is real. Certainty is not.

**2. If you cannot explain a line it wrote, do not accept it.**
Ask it to explain instead — that is a perfectly good use of it. Mystery code you approved is worse
than no code, because you will be the one debugging it on the 7th.

**3. Commit before, diff after.** That is the entire safety net. It is enough.

**4. Wrong direction is worse than slow.**
Thirty seconds reading a plan beats an hour unwinding the wrong work.

One habit worth building immediately: after it produces something, ask

> *"What did you not do, or not verify?"*

Agents answer that honestly far more often than they volunteer the same information unprompted.

---

## When it goes wrong

| Symptom | What to do |
|---|---|
| Claims something is done, you doubt it | Don't argue. **"Show me the exact lines you changed."** Fabrication collapses under a request for specifics |
| Forgot an instruction you gave earlier | It is probably in [AGENTS.md](AGENTS.md) — point at the section by name. If the session is long, start a fresh one |
| Wandered outside the task | Revert, then re-prompt with a `CONSTRAINTS` line naming what not to touch |
| Same fix attempted three times, still broken | **Stop.** It does not understand the problem. Read the code yourself, or ask it to explain what it thinks is happening |
| Added a dependency you didn't ask for | Revert. [AGENTS.md](AGENTS.md) forbids this — point at it |
| Silent about something that failed | Ask directly: *"What failed? Paste the exact error."* |
| Long session producing worse answers | Start a new session. Quality degrades as context fills up |

**The general rule:** if three attempts have not fixed it, the agent is stuck in a loop and more
attempts will not help. Switch to reading the code yourself, or ask it to explain the problem
rather than solve it.

---

## Use our own docs as agent input

This is the return on having written things down. Pointing at a document gets much better results
than re-explaining from scratch:

> *"Implement this per ARCHITECTURE.md §2 — note the telemetry hook goes before the binding check."*

| Document | Useful for |
|---|---|
| [AGENTS.md](AGENTS.md) | Read automatically every session — the rules that must not be broken |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the pieces fit; interfaces |
| [PLAN.md](PLAN.md) | The specification, including exact rules and thresholds |
| [STATUS.md](STATUS.md) | Who owns which directory |

---

## Reference

- **`AGENTS.md`** — open convention ([agents.md](https://agents.md)), read automatically by Codex
  and others. The root file applies repo-wide; a nested one applies to its directory.
- **`CLAUDE.md`** — Claude Code's equivalent. `/init` generates a starting one from the codebase.
- Both can coexist. Ours lives at the repo root.
