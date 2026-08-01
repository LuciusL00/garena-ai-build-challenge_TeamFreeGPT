# Considerations

**Assumptions and open questions that have not yet been confirmed by more than one person.**

Everything in [PLAN.md](PLAN.md) reads as settled. Much of it is actually one person's judgment
call. This file separates the two.

**Rule:** an item stays here until **at least one other team member has looked at it and agreed**.
Only then does it move into PLAN.md as a decision. Items that turn out wrong should be fixed here
first, then propagated.

Ordered by how much damage a wrong answer does.

---

## A. Could break the build — resolve first

### A1. Is Swarmfall's source exportable and extensible?
**Assumed:** yes, the full source can be pulled into this repo and a second person can extend it.

**Why it matters:** the brief requires complete source code as a deliverable. If the game lives on
a builder platform and exports as unreadable generated output, this is submission-blocking, not
inconvenient.

**If wrong:** rebuild a minimal host from scratch. Days of work.

**Confirm by:** immediately.

---

### A2. Do Swarmfall's buttons expose raw pointer data?
**Assumed:** we can capture, for each press, the exact touch coordinates, the release coordinates,
and the duration — relative to the button's bounds.

**Why it matters:** `TouchTelemetry` is built entirely on this. Miss distance, drift and
directional bias are unobtainable if the game's controls sit behind an abstraction that only
reports "button pressed."

**If wrong:** touch measurement collapses to success/failure and latency only. The recommendation
still works, but the advisory layout findings (§5.3 of the plan) disappear, and the story gets
thinner.

**Confirm by:** 2 Aug — it determines what the Touch role can actually build.

---

### A3. Can Swarmfall be embedded in a multi-scene flow?
**Assumed:** the game can be started, stopped and restarted inside a sequence:

```
calibrate → round 1 → calibrate → recommend → round 2 → results
```

**Why it matters:** the entire demo is that sequence. If Swarmfall is a standalone page that
assumes it owns the whole screen and its own lifecycle, wiring it into a flow is real work nobody
has budgeted.

**If wrong:** either refactor the game's lifecycle, or run calibration as a separate page and
accept a clunkier demo.

**Confirm by:** 2 Aug.

---

### A4. Will MediaPipe and Swarmfall run together at acceptable framerate?
**Assumed:** gesture inference at 10–15 fps alongside the game holds ≥45 fps on the target Android.

**Why it matters:** untested. Camera capture plus model inference plus a live game is genuinely
heavy on mid-range phones.

**If wrong:** drop inference rate further, reduce input resolution, or run gesture only during
calibration and not during play — which weakens the demo considerably.

**Confirm by:** 4 Aug, on the real device, not a laptop.

---

## B. Design calls that shape the pitch

### B1. Why is the recommender a rule set rather than a trained model?
**This is the question the team should push back on hardest, so here is the full reasoning.**

**Assumed:** a transparent rule set — thresholds and comparisons — not machine learning.

**Reasoning:**

1. **There is no training data.** A learned recommender needs labelled examples: many player
   profiles, the mapping chosen, and whether it helped. That means hundreds of players. We have
   days and perhaps three testers. There is nothing to train on. A model fitted to a dozen samples
   is overfitting theatre, and a technical judge will identify it immediately.
2. **It has to explain itself before it acts.** The product changes someone's controls. A rule set
   says *"your touch succeeded 68% of the time, your fist 93% — swap them?"* A model says
   *"confidence 0.82."* The player can evaluate the first and can only trust the second. Since the
   whole premise is that the player knows their own needs, an unexplainable recommender
   contradicts the product.
3. **The judging criterion rewards honesty here.** Build Quality assesses *"genuine use of
   AI-driven behaviour."* Real on-device ML for gesture recognition plus honest rules scores better
   than a decorative model that does nothing a comparison of two numbers wouldn't.
4. **A rule you can read is a rule you can fix at 2am on 7 August.**

**Where the AI actually is:** MediaPipe gesture recognition (real on-device ML) and the LLM
grammar (T1). Not the recommender.

**The rules themselves:**

```text
if touch.successRate < 0.80
   and gesture.successRate > touch.successRate + 0.10
   and gesture.falseActivationRate <= 1.0 per minute
→ recommend the swap

if action.spatial            (the lasso)
→ advise against, quote the measured cost, allow the override
```

**Is it simple enough to implement?** Yes — roughly 30 lines. Compare two numbers, apply
thresholds, select an explanation template. **The difficulty in this project is not the
recommender, it is producing trustworthy numbers to feed it.** That is where the effort goes, and
it is why the measurement work is spread across two roles.

**Counter-argument the team should weigh:** the thresholds below (B2) are invented. A rule set
built on arbitrary numbers is not obviously more principled than a small model — it is just more
legible. Legibility is the defence, and it should be stated as such rather than dressed up as rigour.

**Confirm by:** 3 Aug, before the recommender is written.

---

### B2. Every threshold in the rules is invented
**Assumed:** these values are reasonable:

| Value | Used for |
|---|---|
| 0.80 | touch success below which we consider a swap |
| +0.10 | how much better gesture must be |
| 1.0 / min | false-activation ceiling |
| 25% of button radius | directional bias worth reporting |
| 60% same side | consistency check on that bias |
| 15% | repeat-tap rate worth reporting |
| 12 → 20 trials, 15pp gap | adaptive stopping rule |
| ~200 ms | gesture stability window |
| 1.5–3.5 s | random cue delay |

**None are derived from anything.** They are plausible starting points chosen to produce sensible
behaviour on a first pass.

**Why it matters:** the recommendation is only as defensible as its thresholds. If a judge asks
"why 80%?", the honest answer is "we picked it." That is acceptable for a prototype **if stated
plainly**; it is damaging if presented as principled.

**Suggested position:** tune them against real traces during playtesting, then say in the deck that
they were calibrated on a small sample and would be validated properly with more users. Trade-off
transparency is explicitly rewarded (40% criterion).

**Confirm by:** 5 Aug, after there is real data to look at.

---

### B3. Is `SWITCH_TYPE` genuinely non-urgent?
**Assumed:** switching miner/defender is discrete and latency-tolerant, making it a legitimate
gesture candidate.

**Why it matters:** if switching troop type is actually time-critical in real Swarmfall play,
moving it to a channel that adds ~200 ms makes the game worse, and the demo shows our own system
giving bad advice.

**Only the game's author can answer this.**

**If wrong:** add `RECALL` or `HOLD` after all, and use one of those as the remap candidate. Half a
day of game work that is currently unbudgeted.

**Confirm by:** 2 Aug.

---

### B4. Is a closed fist the right first gesture?
**Assumed:** `Closed_Fist` from MediaPipe's built-in set.

**Alternatives:** `Open_Palm` may be more distinguishable from a resting or moving hand, and less
likely to fire accidentally. `Victory` is visually distinctive but awkward to hold.

**Why it matters:** false activations are the fastest way to lose the demo. A gesture that fires
while the player is doing something else destroys the metric and looks broken on video.

**Confirm by:** 4 Aug, empirically — try two and keep the one with fewer false triggers.

---

### B5. Demo ergonomics — propped phone or handheld?
**Assumed:** the phone is propped or held one-handed, with the other hand gesturing.

**Why it matters:** a player holding a phone in landscape with both thumbs cannot make a fist at
the front camera. The demo has to resolve this visibly and honestly, and how it is staged affects
what the video shows.

**Untested on a real device with a real person.**

**Confirm by:** 4 Aug.

---

### B6. Is calibration the right headline metric?
**Assumed:** the primary before/after evidence is a calibration re-run, not in-game performance,
because a second round of play is confounded by practice.

**Why it matters:** this is defensible but less immediately impressive than "I survived longer."
It is a deliberate trade of persuasiveness for honesty.

**If the team disagrees:** the alternative is to lead with in-game results and note the confound.
That is a presentation decision, not a technical one, but it should be a shared one.

**Confirm by:** 5 Aug, before the deck is written.

---

## C. Scope and strategy

### C1. Is the middleware framing right?
**Assumed:** we present a game-agnostic layer, with Swarmfall as the demo host.

**Risk:** it invites *"you built one game with custom controls and called it a platform."* The
defences are the integration snippet (README) and, if there is time, a second demo host (T2).

**Alternative:** present it as one game with adaptive controls. Simpler and less exposed, but a
much smaller claim, and Problem–Solution Fit is 40% of the score.

**Confirm by:** 3 Aug.

---

### C2. Should the LLM component (T1) be built at all?
**Assumed:** yes, if T0 is clear by 6 Aug.

**For:** it was prominent in the submitted proposal, and it is the most legible AI feature to a
non-technical judge. MediaPipe can be read as "an imported library."

**Against:** it is not needed for the core thesis, and we now supply the model ourselves (C3).

**Confirm by:** 6 Aug.

---

### C3. Which model do we use? Garena provides no API access
**Confirmed:** Garena is not providing API access or credits. Teams supply their own. The brief
places no restriction on which model is used.

**Assumed:** a free tier is sufficient. Our usage is tiny — a handful of calls per demo run,
between rounds, never in real time.

**Requirements:**
- Free at our volume, without a credit card if possible
- **Structured output** — the grammar (§6 of the plan) needs the model to return a fixed schema.
  An API that enforces the schema is far better than one where we hope the model complies and
  parse defensively
- A key that never reaches client code, so a serverless function is needed regardless of provider
  (Vercel's free tier covers this)

**Options:**

| Option | Notes |
|---|---|
| **Google Gemini free tier** | Native structured output via `responseSchema` — the API enforces the shape rather than us hoping for it. Generous free limits. **Recommended default.** |
| Groq free tier | Very fast, runs open models, has a JSON mode. Good if latency matters, but schema enforcement is weaker |
| OpenRouter / Together / Cerebras free tiers | Similar; limits and availability vary |
| In-browser model (WebLLM, Transformers.js) | No key, no backend, and it would extend the on-device privacy story to the whole product. But a 1–2 GB download and unreliable schema adherence on a phone. **Not viable for a mobile demo** |

**Recommendation:** Gemini free tier, chosen specifically because native schema enforcement does
the validation work the grammar depends on. We still validate server-side against the allowlist —
the API constraint is a first line, not the only one.

**Whichever is chosen must be recorded in [DISCLOSURE.md](DISCLOSURE.md).**

**Confirm by:** 5 Aug, before T1 starts.

---

### C4. Is one gesture enough?
**Assumed:** yes for T0. Extra gestures are polish.

**Risk:** a single gesture may look thin on video. One that works reliably beats three that fire
at random, but the team should agree that trade explicitly.

**Confirm by:** 6 Aug.

---

## D. Process

### D1. Does the role allocation match actual availability?
**Assumed:** three people, roughly full engagement from 1 Aug.

Role assignments in PLAN.md §9 were written from work requirements, not from anyone's stated
availability. **Nobody has confirmed they can take the Core role**, which is the largest share and
runs all week.

**Confirm by:** immediately.

---

### D2. Will 7 August stay clear for integration?
**Assumed:** yes, and it is protected.

Under deadline pressure it is the first thing that gets eaten by "one more feature." Three people
building separately for a week reliably discover problems only when the pieces meet.

**Confirm by:** state it explicitly to the team now, so it is a shared commitment rather than one
person's plan.

---

### D3. Does everyone accept the working rules?
Branch per person, PRs merged same day, never two people in one file, `git pull` before starting.

These only work if all three follow them. One long-lived branch produces the merge conflict that
eats the integration day.

**Confirm by:** immediately.

---

## Resolved — kept for the record

| Question | Answer | Source |
|---|---|---|
| Are third-party ML libraries permitted? | Yes — no technology restrictions | Case brief |
| Must third-party components be disclosed? | Yes, mandatory | Case brief |
| Is the case release a new problem statement? | No — same open theme | Case brief |
| What are the deliverables? | Deck (15 pp) · private repo + collaborator · video (5 min) | Case brief |
| Judging weights | Problem–Solution Fit 40% · Build Quality 30% · Originality 30% | Case brief |
| Does Swarmfall need new commands for T0? | No — `LASSO` and `SWITCH_TYPE` already exist | Team |
| Does Garena provide LLM API access or credits? | **No.** Teams supply their own — see C3 | Garena |
| Which gesture maps to which command? | Vision Input role decides empirically | Team |
