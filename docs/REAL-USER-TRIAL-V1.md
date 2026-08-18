# InPublic Real User Trial V1

Status: **READY FOR TESTER 1 — FROZEN BUILD**<br>
Study build: **`ac37f04826ea43abecde7d8ae04c845b7d432cae`**<br>
Study owner: **operator of the supervised trial browser**<br>
Target batch: **3–5 people**<br>
Target speaking time: **3–5 minutes per person; shorter is allowed when natural**

This is the live record for the first real-user trial. Do not enter simulated,
internal-replay, or builder-session results as user evidence. Do not change the
frozen presentation system between testers. Complete the whole batch before
recommending an engineering change.

## Production readiness check — 2026-08-17

The public route was checked at `https://inpublic.vercel.app/try` in a clean
browser session.

| Check | Result | Evidence |
|---|---|---|
| Public `/try` loads without authentication | PASS | Page loaded with the product title and no access gate. |
| Tester sees a small, non-technical entry screen | PASS | “Talk. Watch your words become visual.”, “No signup required.”, and “Start Speaking”. |
| Microphone denial is recoverable | PASS | A plain-language permission error and retry path appeared. |
| Granted microphone permission enters the board | PASS | Board opened with speaking controls and a five-minute anonymous allowance. |
| Developer flags are not required | PASS | The ordinary entry route has no required query parameters. |
| Replay/debug panels are absent in production | PASS | No replay lab, latency overlay, or developer export was visible. Production ignored `replay=1`, `v2=1`, and `vr=1`. |
| Current validated stack is on the public deployment | PASS | Vercel deployment `dpl_F81qj3ijLqChZSDz3RjcYNdGWwZr` is Ready/Promoted and reports Git SHA `ac37f04826ea43abecde7d8ae04c845b7d432cae`; its committed defaults are `livePresentationV2: true` and `visualReentryV1: true`. |
| Short zero-query speech validation exercises the validated stack | PASS | Generated validation audio produced 43 thought-boundary events, 7 settled thoughts, 92 V2 events, 7 Visual Re-entry thought receipts, 5 durable visual commits, 2 page turns, and 2 Page Arrival Coalescing events. No generic overview event appeared. This is release evidence, not tester evidence. |
| Guest network path is free of repeated 401s | PASS | All 52 observed production requests were 2xx. Anonymous `/api/projects` calls: 0; `/api/telemetry/latency` calls: 0; `/api/scribe`, `/api/beat`, and `/api/artist` calls: 0; all other 4xx/5xx: 0. The local latency summary and full session evidence remained in IndexedDB. |

### Readiness decision

**READY FOR TESTER 1 — FROZEN BUILD.** The new immutable candidate is deployed,
the validated runtime stack remains active, and the clean guest recheck produced
no invalid authenticated-only request and no 4xx/5xx response. The release
validation is operational evidence only and has not been entered as tester
evidence. No tester was recruited automatically.

Frozen study deployment URL/ID: **`https://inpublic-mhmswnyjn-kenny114s-projects.vercel.app` / `dpl_F81qj3ijLqChZSDz3RjcYNdGWwZr`**<br>
Frozen study commit: **`ac37f04826ea43abecde7d8ae04c845b7d432cae`**<br>
Readiness recheck date/operator: **2026-08-17 / Codex release verification**

## Frozen product scope

Do not change during the batch:

- Live Presentation V2 or Thought Boundary Safety V3
- Visual Re-entry or any visual family
- Page Arrival Coalescing or Generic Overview Removal
- Deepgram path, vocabulary, feature defaults, or telemetry semantics
- camera behavior, page composition, page geometry, or overview behavior
- mobile behavior or onboarding

No tester may receive a different build. Stop and restart the batch if the
frozen deployment changes for any reason.

## Tester instruction

Read only this instruction:

> Try InPublic and talk naturally for a few minutes about anything you know
> well.
>
> You could explain your work, a hobby, a story, how something works, or an
> idea.
>
> Use it however feels natural.

Do not explain the architecture, name visual families, suggest trigger phrases,
or coach the person toward visuals. If they stop naturally, let them stop. Do
not explain confusion immediately unless they are blocked.

## Consent and observation boundary

- Tell the tester what data the product already retains before beginning.
- Obtain explicit consent before screen, audio, video, or observer recording.
- A person declining optional recording may still participate.
- Do not add invasive recording or interrupt a session to manufacture a demo.
- Use participant codes (`T01`, `T02`, …), not names, in this document.

## Capture support audit

The current session event stream already contains the following evidence. The
ordinary production UI deliberately does not expose its developer-only raw-log
download. The approved study method is therefore a read-only IndexedDB export
from the supervised browser profile immediately after each session; do not add
a debug panel to solve this during the study.

| Requested evidence | Already represented | Current retention note |
|---|---|---|
| Session ID | Yes | Session payload and local saved session. |
| Duration | Derivable | Session start plus timestamped events/listening stop. |
| Settled thoughts | Yes | `settled-thought` events. |
| Page turns | Yes | `page` events with reason and `midThought`. |
| Visual Re-entry candidates | Yes | `visual-reentry` candidate/evidence events. |
| Commits/rejections/expiry | Yes | `visual-reentry` decision, grounding, commit, rejection, and expiry events. |
| Camera telemetry | Yes | camera, proposal, coalescing, composition, and camera-metric events. |
| Errors | Yes | `error` events. |
| API failures | Partial | Client-visible failures are logged; server-side request evidence remains in platform logs. |
| Raw transcript | Yes | `rawTranscript` where provided. |
| Final/display transcript | Yes | `text`, `normalizedTranscript`, and `displayTranscript`. |

Approved production retrieval method: **Read the `current` and matching `session:<session-id>` records from the production origin's `inpublic` IndexedDB `sessions` object store immediately after each supervised session, then save the JSON evidence in the consented study folder. The release recheck successfully retrieved session ID, timestamps, transcripts, thought boundaries, settled thoughts, page turns, Visual Re-entry decisions, camera/composition events, and errors this way.**<br>
Retention location and access owner: **The tester evidence remains browser-local until export. Exported evidence is held only in the access-controlled study folder owned by the study operator. Detailed anonymous transcripts/events are not retained in Supabase; the backend retains anonymous allowance/lease accounting and Vercel retains ordinary request logs. Remote, unsupervised testers are out of scope unless an immediate local export can be arranged.**<br>
Retention period/deletion date: **Retain through batch synthesis and final-report acceptance, then delete the exported evidence and clear the production site's browser storage within 30 days after the final report. Delete earlier on consent withdrawal. There is no automatic IndexedDB expiry, so deletion is an operator responsibility.**

## Session worksheet

Duplicate this section once per tester. Preserve timestamps even when the
answer is “none” or “not observed”. Do not infer a reaction the tester did not
show or state.

### Tester T__

| Field | Observation |
|---|---|
| Date/time | |
| Device | DESKTOP / MOBILE / TABLET |
| Browser/OS | |
| Frozen deployment ID | |
| Session ID | |
| Consent granted | Product telemetry: YES/NO; observer notes: YES/NO; screen/audio/video: YES/NO |
| Session start/end | |
| Natural speech duration | |
| Time to first speech | |
| Time to first settled thought | |
| Time to first useful visual | timestamp / NONE |
| Time they appeared to understand the product | timestamp + behavioral evidence / NOT OBSERVED |
| Settled thoughts | |
| Page turns | |
| Visual candidates | |
| Visual commits/rejections/expiry | |
| Camera events | |
| Errors/API failures | |

#### What they did

Timestamped behavioral observations only: starts/stops, waits, repetitions,
unexpected interaction, topic changes, voluntary continuation, sharing, link or
account requests, and returns.

| Timestamp | Observable behavior | Blocked? | Observer intervention |
|---|---|---|---|
| | | YES/NO | NONE / exact help given |

#### Confusion and friction

Capture not knowing what to do, waiting for the board, repetition, questions,
transcript reactions, camera reactions, losing a thought, misunderstood visuals,
unexpected interaction, and missing-function expectations.

| Timestamp | What happened | Exact words, if any | Severity candidate |
|---|---|---|---|
| | | | P0/P1/P2/P3/NONE |

#### Visual analysis

Enter every committed visual. “No reaction” and “no visual” are valid results.

| Timestamp | Family | USEFUL / NEUTRAL / DISTRACTING / MISLEADING | Tester reaction | Improved understanding? | Evidence |
|---|---|---|---|---|---|
| | | | YES/NO/NONE | YES/NO/UNCLEAR | |

#### Camera and page-transition observation

| Timestamp | Noticed movement? | Lost position? | Restless or smooth? | Visual expiry near page turn? | Evidence |
|---|---|---|---|---|---|
| | YES/NO | YES/NO | RESTLESS/SMOOTH/UNNOTICED | YES/NO | |

#### What they said after the session

Keep this separate from behavior. Ask exactly these questions without naming
visuals, camera, speech, pages, or AI.

1. What do you think InPublic does?
2. What did you like?
3. What confused or annoyed you?
4. When would you actually use something like this?
5. Would you use it again?
6. What would make you use it again?

Verbatim or close notes:

| Question | Response |
|---|---|
| 1 | |
| 2 | |
| 3 | |
| 4 | |
| 5 | |
| 6 | |

#### Repeat-use and positive signals

| Signal | SAY / DO | Evidence |
|---|---|---|
| Spoke naturally without coaching | | |
| Understood the board afterward | | |
| Positive visual reaction | | |
| Tried another topic or kept speaking voluntarily | | |
| Wanted to share/export | | |
| Asked for a link/account | | |
| Described a real use case | | |
| Wanted to use it again | | |
| Returned later | | |

#### Demo-content candidate

Only for a naturally strong moment. Also append it to `docs/DEMO-CONTENT.md`.

SESSION: **T__ / session ID**<br>
TIMESTAMP: **PENDING**<br>
WHAT HAPPENED: **PENDING**<br>
WHY IT IS INTERESTING: **PENDING**

## Issue register

Do not promote one weak anecdote into a recommendation. Prioritize a repeated
problem, one catastrophic P0/P1, or extremely strong behavioral evidence.

| ISSUE | TESTERS AFFECTED | SEVERITY | FREQUENCY | BEHAVIORAL EVIDENCE | VIEWER/USER IMPACT | SUBSYSTEM |
|---|---:|---|---:|---|---|---|
| No tester-derived issues yet | 0 | — | 0/0 | Study not started | — | — |

Severity definitions:

- P0 — cannot use product
- P1 — materially damages the core experience
- P2 — noticeable friction
- P3 — polish

## Batch synthesis

Complete only after 3–5 real testers have used the same frozen deployment.
Keep desktop and mobile denominators separate.

### Testers

**PENDING — 0 completed**

### Devices

**PENDING**

### Session lengths

**PENDING**

### What users thought InPublic was

**PENDING**

### Time to value

**PENDING**

### Positive reactions

**PENDING**

### Confusion/friction

**PENDING**

### Visual reactions

**PENDING**

### Camera reactions

**PENDING**

### Mobile vs desktop

**PENDING — do not combine device conclusions**

### Repeat-use signals

**PENDING**

### Strongest positive signal

**PENDING**

### Strongest negative signal

**PENDING**

### Demo-content moments captured

**PENDING**

### What we expected that users did NOT care about

**PENDING**

### What users cared about that we did NOT expect

**PENDING**

### Recommended SINGLE next direction

**NO DIRECTION SELECTED — USER EVIDENCE DOES NOT EXIST YET.**

After the batch, select exactly one:

- A. Fix a repeated P0/P1 product defect
- B. Fix onboarding / time-to-value
- C. Work on mobile
- D. Fix visual lifecycle / page-turn expiry
- E. Investigate camera experience
- F. Expand visual expression
- G. Keep current build and get more users

Do not implement the selected recommendation in this study.

## Required final answers

1. Could users understand InPublic without explanation? **PENDING**
2. Could they start speaking without help? **PENDING**
3. Did anyone get blocked? **PENDING**
4. Did anyone experience a P0? **PENDING**
5. Did anyone experience a P1? **PENDING**
6. Did users find the visuals useful? **PENDING**
7. Did any visual confuse or mislead them? **PENDING**
8. Did anyone notice or complain about the camera? **PENDING**
9. Did mobile materially underperform desktop? **PENDING**
10. Did anyone voluntarily keep speaking or try another example? **PENDING**
11. Did anyone describe a real use case themselves? **PENDING**
12. Did anyone want to use InPublic again? **PENDING**
13. What problem repeated most? **PENDING**
14. What feature/value repeated most positively? **PENDING**
15. Based on user evidence, what ONE thing should we work on next? **PENDING**
