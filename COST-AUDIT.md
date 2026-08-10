# InPublic — user-cost and unit-economics audit

**Date:** 2026-08-09 · **Branch:** `agent/redesign-inpublic-product` @ `bb591e3`
**Method:** full source inspection of `app/`, `lib/`, `components/`, `hooks/`, `package.json`, `.env.example`, `.env.local` (key *names* only — no secret values read or reproduced); exact system-prompt token counts measured against Anthropic's `count_tokens` endpoint; provider prices fetched live and cited below. Prior evidence reused from `AUDIT-3.md` (2026-08-09), which measured latencies against a live dev server with real keys.
**Nothing in the product, pricing, infrastructure, or code was modified.**

### Legend used throughout

| Tag | Meaning |
|---|---|
| **[CODE]** | Verified by reading the implementation. File and line cited. |
| **[PRICE]** | Verified against a provider's published pricing page, with URL and date. |
| **[CALC]** | Arithmetic derived from [CODE] + [PRICE]. Formula shown. |
| **[ASSUM]** | An assumption I made because the code cannot answer it. Stated explicitly. |
| **[UNKNOWN]** | Cannot be determined without production measurement. Not guessed. |

---

## 1. Executive verdict

**The proposed pricing loses money by roughly an order of magnitude on Creator, and the free plan cannot be subsidised by it.**

Three findings dominate everything else in this report.

**1. Creator at $15/month for 1,000 minutes costs $62–$98/month to serve.** [CALC] The variable cost of Standard Mode is **$0.055/min at the start of a session and $0.15/min two hours in** — it rises with session length because the full diagram history is re-sent to the model on every beat. Net revenue after Whop fees is **$14.295**. A Creator who consumes their allowance produces a gross margin between **−331% and −588%**. Break-even is **232 minutes**, not 1,000. A 70% gross margin is reached at **70 minutes**.

**2. Creator loses money at 25% utilisation, so it cannot subsidise a single free user.** [CALC] 250 minutes costs $15.39 against $14.295 net revenue. Even under a deliberately optimistic distribution (60% of Creators use 10% of their allowance), the blended gross margin is **4.2%** — one heavy user erases the surplus from a dozen light ones. Of the five free-to-paid ratios requested, only **1 paid : 2 free at ≤50% free utilisation** survives, and only if Creators average ≤100 minutes. 1:5, 1:10, 1:20 and 1:50 all lose money at every utilisation level tested.

**3. The single largest financial risk is not pricing — it is that the API routes are unauthenticated and unmetered.** [CODE] `app/api/scribe`, `/beat`, `/artist`, `/story` and `/deepgram/token` accept anonymous POST/GET from any origin. There is no `middleware.ts`, no rate limit, no origin check, no user identity, and no usage counter anywhere in the repository. `GET /api/deepgram/token` mints a live Deepgram credential to any caller ([`app/api/deepgram/token/route.ts:16`](app/api/deepgram/token/route.ts#L16)), and its fallback path creates a *real project API key* via `createProjectKey` ([line 51](app/api/deepgram/token/route.ts#L51)). A single scripted client can spend Sonnet 4.6 tokens and Deepgram minutes without limit, today.

Two findings run the other way and are genuinely good news:

- **Video, camera, exports, storage, and downloads cost the company exactly $0.** [CODE] Recording is `canvas.captureStream` + `MediaRecorder` in the browser ([`hooks/useCanvasRecorder.ts:263`](hooks/useCanvasRecorder.ts#L263)); persistence is IndexedDB ([`lib/persist.ts`](lib/persist.ts), [`lib/recordings.ts`](lib/recordings.ts)); exports are local blob URLs ([`lib/exports.ts`](lib/exports.ts)). There is no server-side render, no object storage, and no egress. **100% of variable cost is speech-to-text plus LLM tokens.**
- **Story Mode is ~2.5× cheaper than Standard Mode**, not more expensive. [CALC] It makes one Haiku call per completed thought and skips the Scribe and the Sonnet Artist entirely ([`components/Board.tsx:1773`](components/Board.tsx#L1773), [`:2695`](components/Board.tsx#L2695) — both return early unless `mode === "standard"`). The expensive feature is the default mode, not the marquee one.

**The product principle "everyone gets the complete experience, Creator just gives you more time" is sound and cheap to honour. The specific minute allowances are not survivable.** Recommended allowances at the current implementation: **Free 30 min/month, Creator 250 min at $19/month** — or ship 1,000 minutes only after the cost-reduction work in §15, which I estimate can cut cost per minute by 60–75%.

---

## 2. Current architecture and provider map

### 2.1 What actually exists

`package.json` declares **nine** runtime dependencies. There is no database client, no object-storage SDK, no auth provider, no queue, no analytics, no email, no error tracker, no payment SDK. [CODE]

```
@anthropic-ai/sdk  @deepgram/sdk  @google/genai
@excalidraw/excalidraw  @excalidraw/mermaid-to-excalidraw
lucide-react  next  react  react-dom
```

Environment variable *names* present: `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `BEAT_MODEL`, `ARTIST_MODEL`, `STORY_MODEL`, `SCRIBE_MODEL`, `LIVE_MODEL`, `NEXT_PUBLIC_ENGINE`, `NEXT_PUBLIC_SCRIBE`, `NEXT_PUBLIC_DISCORD_URL`. No secret values are reproduced here. [CODE]

### 2.2 The pipeline, stage by stage

| # | Stage | Where it runs | Provider / model | Endpoint | Frequency | Consumes | Cost scales with |
|---|---|---|---|---|---|---|---|
| 1 | User speaks | Browser | — | — | — | — | — |
| 2 | Audio capture | Browser | `getUserMedia` + `MediaRecorder`, 100 ms chunks ([`useDeepgram.ts:245`](hooks/useDeepgram.ts#L245)) | — | continuous | mic | nothing |
| 3 | Credential mint | **Server** | Deepgram `auth.grantToken`, 60 s TTL ([`deepgram/token/route.ts:28`](app/api/deepgram/token/route.ts#L28)) | `/api/deepgram/token` | 1 per socket open + 1 per reconnect | 1 fn invocation | reconnects |
| 4 | Transcription | Browser ↔ Deepgram | **nova-3**, `interim_results`, `endpointing:150`, `utterance_end_ms:1000`, `smart_format`, `punctuate`, ≤40 keyterms ([`useDeepgram.ts:206`](hooks/useDeepgram.ts#L206)) | `wss://api.deepgram.com/v1/listen` | continuous while mic is on | **audio seconds** | **wall-clock minute, incl. silence** |
| 5 | Live line | Browser | none | — | every interim | 1–6 ms CPU (measured, AUDIT-3) | nothing |
| 6a | **Scribe** (Standard) | **Server**, streaming | **`claude-haiku-4-5`** ([`lib/llm.ts:29`](lib/llm.ts#L29)) | `POST /api/scribe` → Anthropic Messages, `stream:true`, `max_tokens:200`, `temp 0.4` | on each Deepgram **final**, throttled to ≥700 ms ([`Board.tsx:166`](components/Board.tsx#L166), `:1904`) | in ≈1,145 tok / out ≈60 tok | **speech events** |
| 6b | **Beat** (Standard) | **Server** | **`claude-haiku-4-5`** ([`lib/llm.ts:24`](lib/llm.ts#L24)) | `POST /api/beat`, `max_tokens:300`, `temp 0` | on 600 ms silence after a complete thought, or 1,600 ms grace on a fragment; requires >4 words ([`Board.tsx:2930`](components/Board.tsx#L2930)) | in 2,665→11,960 tok / out ≈60 | **speech events × session age** |
| 6c | **Artist** (Standard) | **Server** | **`claude-sonnet-4-6`** ([`lib/llm.ts:25`](lib/llm.ts#L25)) | `POST /api/artist`, `max_tokens:1200`, `temp 0.3` | only when the Beat returns `draw` or `command` ([`Board.tsx:2800`](components/Board.tsx#L2800)) | in 3,140→12,440 tok / out ≈450 | **draw decisions × session age** |
| 6d | **Story interpreter** | **Server** | `STORY_MODEL` → defaults to `BEAT_MODEL` = **`claude-haiku-4-5`** ([`lib/llm.ts:27`](lib/llm.ts#L27)) | `POST /api/story`, `max_tokens:1000`, `temp 0.1` | one per *completed thought*; gated by `isThoughtComplete` ([`story/route.ts:25`](app/api/story/route.ts#L25)) | in ≈2,600–4,500 / out ≈350 | **completed thoughts** |
| 7 | Canvas ops | Browser | none — Excalidraw primitives, procedural SVG-ish shapes ([`lib/storyAssets.ts`](lib/storyAssets.ts), [`lib/storyPrimitives.ts`](lib/storyPrimitives.ts)) | — | per op | CPU | nothing |
| 8 | Camera + canvas recording | **Browser** | none | — | 30 fps rAF composite ([`useCanvasRecorder.ts:144`](hooks/useCanvasRecorder.ts#L144)) | client CPU + client disk | **nothing** |
| 9 | Session save | **Browser** | IndexedDB `inpublic` v2, 3 s trailing debounce ([`lib/persist.ts:219`](lib/persist.ts#L219)) | — | ≤1 per 3 s | client disk | nothing |
| 10 | Video render/export | **Browser** | `MediaRecorder` → Blob → object URL ([`lib/recordings.ts:103`](lib/recordings.ts#L103)) | — | on demand | client CPU | **nothing** |
| 11 | File storage | **Browser** IndexedDB, 2 object stores; recordings capped at `FREE_SESSION_LIMIT = 5`, oldest evicted ([`lib/recordings.ts:66`](lib/recordings.ts#L66)) | — | — | — | client disk | **nothing** |
| 12 | Reopen / replay / download | **Browser** | IndexedDB read + blob URL | — | on demand | client CPU | **nothing** |

### 2.3 Things the product does not have

Verified absent by grep across the whole tree: image generation, embeddings, vector search, text-to-speech, server-side video encoding, background workers, queues, any database, any object store, realtime/websocket backend of our own, CDN configuration beyond Vercel defaults, authentication (`lib/auth.ts` is a `localStorage` email string, honestly documented as "not a security boundary"), billing (`lib/billing.ts` hard-codes `configured: false`), email, analytics, logging sink, error tracking. [CODE]

The Gemini Live engine (`hooks/useGeminiLive.ts`, 368 lines) is fully implemented but **inactive** — `NEXT_PUBLIC_ENGINE` is `deepgram`. It is a second cost surface that is carried but not currently billed. [CODE]

### 2.4 The two-provider model shim

`lib/llm.ts:20` routes by model-id prefix: anything starting `gemini` → Google Generative Language API, everything else → Anthropic. All four model slots default to Anthropic. **`claude-sonnet-4-6` is a valid, current model ID** (verified against the Anthropic model catalogue). `claude-haiku-4-5-20251001` is likewise valid.

---

## 3. Complete cost inventory

### 3.1 Verified provider prices

| Item | Price | Source | Checked |
|---|---|---|---|
| Deepgram **nova-3** streaming, monolingual, pay-as-you-go | **$0.0048 / min** | https://deepgram.com/pricing | 2026-08-09 |
| Deepgram nova-3 streaming, Growth tier | $0.0042 / min | ” | ” |
| Deepgram nova-3 streaming, multilingual PAYG | $0.0058 / min | ” | ” |
| **Claude Haiku 4.5** | **$1.00 / MTok in · $5.00 / MTok out** | Anthropic model catalogue (`claude-api` skill, cached 2026-06-24) | 2026-08-09 |
| **Claude Sonnet 4.6** | **$3.00 / MTok in · $15.00 / MTok out** | ” | ” |
| Vercel Pro | $20 / seat / month | https://vercel.com/pricing | 2026-08-09 |
| Vercel fast data transfer | 1 TB included, then **$0.15 / GB** | ” | ” |
| Vercel function invocations | **$0.60 / 1M** | ” | ” |
| Vercel function duration | **$0.0106 / GB-hr** | ” | ” |
| Vercel active CPU | $0.128 / hr | ” | ” |
| Vercel edge requests | 10M included, then $2 / 1M | ” | ” |
| Whop card processing, domestic | **2.7% + $0.30** | https://docs.whop.com/fees | 2026-08-09 |
| Whop, international card surcharge | +1.5% | ” | ” |
| Whop, FX conversion | +1% | ” | ” |
| Whop **affiliate processing fee** | **1.25% / transaction** | ” | ” |
| Whop chargeback / dispute | **$15.00** | ” | ” |
| Whop early dispute alert | $29.00 | ” | ” |
| Whop payout, next-day ACH | $2.50 | ” | ” |
| Whop Radar fraud detection | $0.07 / txn (if enabled) | ” | ” |
| Whop 3DS | $0.03 / txn (if enabled) | ” | ” |
| Whop tax & remittance | 2% (if enabled) | ” | ” |

Whop's **3% platform fee** on Discord/Telegram/TradingView-gated sales is reported by third-party comparisons but is **not** in Whop's own fee documentation and does not apply to a standalone web app. Not included in the models below. [UNKNOWN — confirm with Whop before launch.]

### 3.2 Measured system-prompt sizes

Measured with `POST /v1/messages/count_tokens` against `claude-haiku-4-5` (free endpoint), 2026-08-09. Includes envelope overhead of ~10 tokens.

| Prompt | Tokens | Used by |
|---|---:|---|
| `SCRIBE_SYSTEM` | **965** | `/api/scribe`, every 700 ms of speech |
| `BEAT_SYSTEM` | **1,190** | `/api/beat`, ~5.7×/min |
| `ARTIST_SYSTEM` | **1,241** | `/api/artist`, ~1.4×/min |
| `STORY_SYSTEM` | **1,612** | `/api/story`, ~5×/min in Story Mode |
| `LIVE_SCRIBE_SYSTEM` | 704 | Gemini engine only — currently inactive |

**There is no prompt caching anywhere.** [CODE] `grep -r cache_control lib app components` returns nothing; `lib/llm.ts:147` sends a bare `messages.create`. Every one of these system prompts is re-billed at full input price on every single call. At 5.7 beats/min that is 6,783 wasted input tokens per minute on the Beat alone.

### 3.3 Cost categories

**Fixed monthly infrastructure** — Vercel Pro $20 (1 seat) + domain ≈ $1.50 amortised = **≈ $21.50/month**, flat until ~100k users. [ASSUM: single-seat Vercel Pro; no separate staging.] No DB, storage, queue, email, or observability line items exist to bill.

**Per registered user** — **$0.00.** There is no account record, no row, no mailbox, no storage bucket. An inactive registrant costs literally nothing but their share of the $21.50 fixed cost.

**Per active user** — entirely a function of minutes; see §4–§7.

**Per session** — see §5. Session *overhead* beyond minutes is one extra `/api/deepgram/token` invocation (~$0.0000006) and a small fixed prompt warm-up. Negligible.

**Per active minute** — §4. This is the whole business.

**Per exported video — $0.00.** [CODE] `useCanvasRecorder.exportLast` → `downloadBlob` → `URL.createObjectURL` ([`lib/recordings.ts:103`](lib/recordings.ts#L103)). Nothing crosses the network. Exporting three times costs the same as exporting zero times.

**Per GB stored — $0.00.** IndexedDB on the user's own disk.

**Per GB downloaded — $0.00** for media. Bandwidth is app-bundle + API JSON only: ~2.5 MB first load (Excalidraw dominates), then cached; API JSON ~14 requests/min at ~4 KB round-trip ≈ 3.4 MB/hour of speech. [ASSUM: bundle size from typical Excalidraw builds; not measured here.]

**Payment cost per Creator subscription** — $0.705/month domestic (2.7% + $0.30); $0.93 with the international surcharge; $1.08 with FX. Plus $0.19 if the sale carries an affiliate. Plus $15 per dispute, which at a 0.5% dispute rate spreads to $0.075/subscriber/month. [ASSUM: 0.5% dispute rate, typical for creator-platform subscriptions.]

**Failed requests and retries** — three paid retry paths exist. (a) `completeGoogle` retries the whole request after a 400 ([`lib/llm.ts:206`](lib/llm.ts#L206)) — double-billed, Gemini path only. (b) Deepgram reconnect, up to 12 attempts with capped backoff ([`useDeepgram.ts:53`](hooks/useDeepgram.ts#L53)) — token mint is cheap, but audio continues to bill. (c) On Artist failure the pending text is deliberately *not* retired ([`Board.tsx:2818`](components/Board.tsx#L2818)), so the next Beat re-processes the same words — a paid duplicate Beat, by design.

---

## 4. Cost per minute

### 4.1 Call rates

The code comments cite a real measured session ("the 10:09 session") in three independent places, which gives usable observed rates: **84 utterances** ([`useDeepgram.ts:95`](hooks/useDeepgram.ts#L95)) and **58 beats** ([`Board.tsx:2915`](components/Board.tsx#L2915)) over 10 min 09 s.

| Call | Rate/min | Basis |
|---|---:|---|
| Deepgram finals | 8.3 | 84 / 10.15 min [CODE, observed] |
| Scribe | **7.0** | one per final, coalesced by the 700 ms throttle and in-flight queue [CODE + ASSUM] |
| Beat | **5.7** | 58 / 10.15 min [CODE, observed] |
| Artist | **1.4** | Beat draw-rate of 25% [ASSUM — AUDIT-3 §7 documents heavy over-skipping; not directly measured] |
| Story (Story Mode) | **5.0** | one per completed thought, `STRUCTURAL_HOLD_MS = 1600` [CODE + ASSUM] |

### 4.2 The growth term — the core cost mechanic

`sceneSummary()` sends **every frame ever drawn** to both the Beat and the Artist on every call. [CODE] `framesRef` is push-only ([`Board.tsx:2010`](components/Board.tsx#L2010)) and is read in full at [`Board.tsx:461`](components/Board.tsx#L461). Nothing prunes it.

The semantic scene *is* capped at 24 concepts ([`lib/semantic.ts:390`](lib/semantic.ts#L390)) — that part is well built. The frame list is not.

At 1.4 draws/min and ≈55 tokens per frame entry, **every minute of session adds ~77 tokens to the input of every subsequent Beat and Artist call.** At 5.7 + 1.4 = 7.1 such calls/min, that is a compounding term.

### 4.3 Per-call cost

Payload composition read from [`app/api/scribe/route.ts:29`](app/api/scribe/route.ts#L29), [`app/api/beat/route.ts:75`](app/api/beat/route.ts#L75), [`app/api/artist/route.ts:28`](app/api/artist/route.ts#L28). Variable-part sizes are [ASSUM] estimates from the field caps in code (24 on-page labels, 40-word context, 120-word pending text, 90 s transcript window, 24 concepts).

| Call | Model | Input tok (min *m*) | Output tok | Cost at m=1 | at m=20 | at m=120 |
|---|---|---|---:|---:|---:|---:|
| Scribe | Haiku 4.5 | 1,145 (flat) | 60 | $0.001445 | $0.001445 | $0.001445 |
| Beat | Haiku 4.5 | 2,610 + 77m | 60 | $0.002965 | $0.004450 | $0.012260 |
| Artist | Sonnet 4.6 | 3,085 + 77m | 450 | $0.016170 | $0.020670 | $0.044070 |
| Story | Haiku 4.5 | 2,412 + ~15m | 350 | $0.004350 | $0.004650 | $0.005600 |

### 4.4 The formula

**Standard Mode, average intensity:**

```
$/min(m) = 0.0048                                    ← Deepgram nova-3
         + 7.0 × 0.001445                            ← Scribe   = 0.010115
         + 5.7 × [(2610 + 77m)·10⁻⁶ + 0.0003]        ← Beat     = 0.016587 + 0.000439m
         + 1.4 × [(3085 + 77m)·3·10⁻⁶ + 0.00675]     ← Artist   = 0.022407 + 0.000323m

         = $0.0539 + $0.000762·m
```

Integrating over a session of length *T* minutes:

```
Session cost C(T) = 0.053909·T + 0.000381·T²
```

**Story Mode:** `$/min(m) = 0.0048 + 5.0 × [(2412 + 15m)·10⁻⁶ + 0.00175] = 0.0266 + 0.000075m`, so `C_story(T) = 0.0266T + 0.0000375T²`.

### 4.5 Headline numbers

| Scenario | $/minute |
|---|---:|
| Silence only (mic open, nobody speaking) | **$0.0048** |
| Story Mode, average | **$0.027 – $0.036** |
| Standard Mode, minute 1 | **$0.055** |
| Standard Mode, averaged over a 20-min session | **$0.0616** |
| Standard Mode, averaged over a 2-hour session | **$0.0996** |
| Standard Mode, minute 120 (marginal) | **$0.145** |
| High intensity, minute 120 (marginal) | **$0.466** |
| Plausible worst case, minute 120 (marginal) | **$0.511** |

**Estimated average cost of one visual-speech minute: $0.065.** [ASSUM: 80% Standard / 20% Story, typical session ≈25 min.]

---

## 5. Cost per session

`C(T) = 0.053909T + 0.000381T²` for Standard; camera, exports, save, and storage all add **$0.00**.

| Duration | Std, no cam | Std, **+camera** | Story, no cam | Story, +camera | Saved only | Exported ×1 | Exported ×3 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 min | $0.054 | **$0.054** | $0.027 | $0.027 | +$0 | +$0 | +$0 |
| 5 min | $0.279 | $0.279 | $0.134 | $0.134 | +$0 | +$0 | +$0 |
| 10 min | $0.577 | $0.577 | $0.270 | $0.270 | +$0 | +$0 | +$0 |
| **20 min** (Free cap) | **$1.231** | **$1.231** | $0.547 | $0.547 | +$0 | +$0 | +$0 |
| 30 min | $1.960 | $1.960 | $0.832 | $0.832 | +$0 | +$0 | +$0 |
| 60 min | $4.606 | $4.606 | $1.731 | $1.731 | +$0 | +$0 | +$0 |
| **120 min** (Creator cap) | **$11.955** | **$11.955** | $3.732 | $3.732 | +$0 | +$0 | +$0 |

### Intensity bands (Standard Mode)

| Duration | Average | High intensity¹ | Plausible worst case² |
|---|---:|---:|---:|
| 20 min | $1.23 | **$2.50** | $3.41 |
| 60 min | $4.61 | **$8.41** | $13.94 |
| 120 min | $11.96 | **$33.56** | **$39.03** |

¹ Fast continuous speech: 12 finals/min → 10 Scribe, 8 Beat, 40% draw rate (3.2 Artist/min).
`$/min(m) = 0.09375 + 0.003098m`.
² High intensity **and** the Artist emitting its full 1,200-token `max_tokens` and the Beat its full 300 on every call. `$/min(m) = 0.13935 + 0.003098m`. This is a real ceiling, not a fantasy — `max_tokens` is the only bound.

**A single 2-hour Creator session in worst case costs $39.03 — 2.6× the entire monthly subscription price.**

---

## 6. Free-user monthly cost

Free is capped at 20-minute sessions ([`lib/product.ts:4`](lib/product.ts#L4)), so all Free sessions cost at most $1.231. Cost per Free minute is therefore a flat **$0.0616**.

| Free user | AI/API | Compute | DB | Storage | Bandwidth | Export | Payment | **Total** | Revenue | Gross profit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Registered, inactive | $0.00 | $0.00 | $0 | $0 | ~$0.00 | $0 | $0 | **$0.00** | $0 | **$0.00** |
| 10 min used | $0.577 | $0.0012 | $0 | $0 | $0.0006 | $0 | $0 | **$0.58** | $0 | **−$0.58** |
| 30 min used | $1.845 | $0.0037 | $0 | $0 | $0.0017 | $0 | $0 | **$1.85** | $0 | **−$1.85** |
| 60 min used | $3.689 | $0.0074 | $0 | $0 | $0.0034 | $0 | $0 | **$3.70** | $0 | **−$3.70** |
| **Full 120 min** | **$7.379** | $0.0148 | $0 | $0 | $0.0068 | $0 | $0 | **$7.40** | $0 | **−$7.40** |
| 120 min + max storage + max downloads | $7.379 | $0.0148 | $0 | **$0** | $0.0068 | **$0** | $0 | **$7.40** | $0 | **−$7.40** |

Note the last two rows are identical. **Maxing out storage and downloads adds nothing**, because both live on the user's machine. Compute = Vercel invocations + GB-hr; bandwidth = API JSON only, amortised bundle excluded after first load.

**A fully-active free user costs $7.40/month. That is 52% of a Creator's entire net revenue — for one free user.**

---

## 7. Creator monthly cost

Two session shapes shown, because session length materially changes cost via the growth term. Net revenue = $15 − 2.7% − $0.30 = **$14.295**.

### 7A — usage taken in 20-minute sessions (best case for us)

| Creator | AI/API | Compute | DB | Storage | Bandwidth | Export | Payment | **Total cost** | Revenue (net) | Gross profit | **GM** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 min | $6.155 | $0.012 | $0 | $0 | $0.006 | $0 | $0.705 | **$6.88** | $14.295 | **+$7.42** | **+51.9%** |
| 250 min | $15.386 | $0.031 | $0 | $0 | $0.014 | $0 | $0.705 | **$16.14** | $14.295 | **−$1.84** | **−12.9%** |
| 500 min | $30.773 | $0.062 | $0 | $0 | $0.028 | $0 | $0.705 | **$31.57** | $14.295 | **−$17.27** | **−120.8%** |
| **1,000 min** | **$61.545** | $0.124 | $0 | $0 | $0.057 | $0 | $0.705 | **$62.43** | $14.295 | **−$48.14** | **−336.7%** |

### 7B — usage taken in 2-hour sessions (the shape Creator's 2-hour cap invites)

| Creator | AI/API | Total cost | Revenue (net) | Gross profit | **GM** |
|---|---:|---:|---:|---:|---:|
| 100 min | $9.196 | $9.92 | $14.295 | +$4.38 | +30.6% |
| 250 min | $24.487 | $25.24 | $14.295 | −$10.94 | −76.5% |
| 500 min | $49.047 | $49.85 | $14.295 | −$35.55 | −248.7% |
| **1,000 min, max Story Mode, camera, exports, storage, downloads** | **$98.41** | **$99.31** | $14.295 | **−$85.02** | **−594.8%** |

The "max everything" row is not worse than the plain 1,000-minute row for camera/export/storage reasons — those are free. It is worse purely because long sessions compound the frame-history term. If the user spent all 1,000 minutes in *Story Mode* instead, cost would fall to ~$31 — still a loss, but a third of the Standard Mode figure.

---

## 8. $15 Creator gross-margin analysis

**Net revenue from one $15 Whop subscription:**

| Line | Domestic | International card | International + FX |
|---|---:|---:|---:|
| Gross | $15.000 | $15.000 | $15.000 |
| Processing 2.7% | −$0.405 | −$0.405 | −$0.405 |
| Fixed $0.30 | −$0.300 | −$0.300 | −$0.300 |
| Intl surcharge 1.5% | — | −$0.225 | −$0.225 |
| FX 1% | — | — | −$0.150 |
| **Net** | **$14.295** | **$14.070** | **$13.920** |

Optional Whop services, if enabled, subtract further: Radar $0.07, 3DS $0.03, tax & remittance 2% ($0.30), orchestration 0.8% ($0.12), billing automation 0.5% ($0.075). A fully-loaded Whop configuration nets **$13.10**. Disputes at an assumed 0.5% rate spread $0.075/subscriber/month.

**Break-even and margin thresholds** (at $0.0616/min, domestic, no affiliate):

| Target | Allowed monthly cost | **Minutes** |
|---|---:|---:|
| Break-even (0% GM) | $14.295 | **232 min** |
| 50% gross margin | $7.148 | **116 min** |
| **70% gross margin** | **$4.289** | **70 min** |
| 80% gross margin | $2.859 | 46 min |

**Subscription price required to support 1,000 fully-consumed minutes:**

| Session shape | Cost | Price at break-even | Price at **70% GM** |
|---|---:|---:|---:|
| 20-min sessions | $61.55 | **$63.57** | **$211.03** |
| 2-hour sessions | $98.41 | **$101.45** | **$337.35** |

Formula: `P = (cost/target_margin_fraction + 0.30) / 0.973`.

**Are heavy Creators subsidised by light ones?** Yes, and the pool is far too thin.

| Distribution of Creators | Avg cost/Creator | Avg GP | **Blended GM** |
|---|---:|---:|---:|
| All at 10% (100 min) | $6.86 | +$7.44 | +52.0% |
| All at 25% (250 min) | $16.09 | −$1.80 | −12.6% |
| All at 50% (500 min) | $31.48 | −$17.19 | −120.2% |
| **All at 100%** | **$62.32** | **−$48.02** | **−335.9%** |
| Mixed: 60%@10 · 25%@25 · 10%@50 · 5%@100 | $13.70 | **+$0.60** | **+4.2%** |

Even that deliberately light mixed distribution — where three in five Creators barely touch the product — yields a **4.2% gross margin before any free-user cost, before support, before salaries**. The economics do not survive one power user per twenty.

---

## 9. Affiliate commission scenarios

Whop charges a **1.25% affiliate processing fee** on affiliate-attributed transactions, on top of the commission itself.

| | 0% affiliate | 30% recurring | 60% recurring |
|---|---:|---:|---:|
| Gross revenue | $15.000 | $15.000 | $15.000 |
| Whop processing (2.7% + $0.30) | −$0.705 | −$0.705 | −$0.705 |
| Whop affiliate processing (1.25%) | — | −$0.188 | −$0.188 |
| Affiliate payment | — | −$4.500 | −$9.000 |
| **Net revenue before infrastructure** | **$14.295** | **$9.608** | **$5.108** |
| Max sustainable cost @ 70% GM | $4.289 | $2.882 | $1.532 |
| **→ minutes affordable @ 70% GM** | **70** | **47** | **25** |
| Break-even minutes | **232** | **156** | **83** |
| Cost if user consumes all 1,000 min | $61.55 | $61.55 | $61.55 |
| **Profit / loss at 1,000 min** | **−$47.25** | **−$51.94** | **−$56.44** |
| **Gross margin at 1,000 min** | **−330.5%** | **−540.6%** | **−1,105.0%** |

At a 60% recurring affiliate commission the plan supports **25 minutes per month** at a healthy margin. The advertised allowance is 40× that.

---

## 10. Free-to-paid subsidy model

Free-user cost per month: 25% util (30 min) = **$1.85**; 50% (60 min) = **$3.69**; 100% (120 min) = **$7.38**.

Creator surplus available for subsidy (net revenue − Creator's own cost):

| Creator utilisation | Creator cost | **Surplus** |
|---|---:|---:|
| 10% (100 min) | $6.86 | **+$7.44** |
| 25% (250 min) | $16.09 | **−$1.80** |
| 50%+ | ≥$31.48 | **≤−$17.19** |

**At 25% Creator utilisation or above, the surplus is negative and no free user can be subsidised at any ratio.** The table below therefore uses the most favourable Creator assumption — 10% utilisation, surplus $7.44.

| Ratio | Free cost @25% util | Net | @50% util | Net | @100% util | Net |
|---|---:|---:|---:|---:|---:|---:|
| **1 : 2** | $3.69 | **+$3.75 ✅** | $7.38 | **+$0.06 ✅** | $14.76 | −$7.32 ❌ |
| 1 : 5 | $9.23 | −$1.79 ❌ | $18.45 | −$11.01 ❌ | $36.90 | −$29.46 ❌ |
| 1 : 10 | $18.45 | −$11.01 ❌ | $36.90 | −$29.46 ❌ | $73.80 | −$66.36 ❌ |
| 1 : 20 | $36.90 | −$29.46 ❌ | $73.80 | −$66.36 ❌ | $147.60 | −$140.16 ❌ |
| 1 : 50 | $92.25 | −$84.81 ❌ | $184.50 | −$177.06 ❌ | $369.00 | −$361.56 ❌ |

**Maximum sustainable active free users per Creator (best case, 10%-utilisation Creator):**

| Free utilisation | Max free users per Creator |
|---|---:|
| 25% (30 min) | **4.0** |
| 50% (60 min) | **2.0** |
| **100% (120 min)** | **1.0** |

At a realistic 25%-utilisation Creator: **zero** at every free-utilisation level.

### Scale model

[ASSUM] 3% free→paid conversion; free users average 40% utilisation (48 min → $2.95); Creators average 30% (300 min → $19.17 cost).

| Active users | Free / Paid | Free cost | Creator cost | Fixed | **Total cost** | Revenue (net) | **Net monthly** |
|---|---|---:|---:|---:|---:|---:|---:|
| 100 | 97 / 3 | $286 | $58 | $22 | **$366** | $43 | **−$323** |
| 1,000 | 970 / 30 | $2,862 | $575 | $22 | **$3,459** | $429 | **−$3,030** |
| 10,000 | 9,700 / 300 | $28,615 | $5,751 | $60 | **$34,426** | $4,289 | **−$30,137** |
| **100,000** | 97,000 / 3,000 | $286,150 | $57,510 | $210 | **$343,870** | $42,885 | **−$300,985** |

At 100k active users the fixed infrastructure is $210/month and the variable AI bill is **$343,660/month**. Bandwidth crosses Vercel's 1 TB Pro allowance at roughly 100k monthly actives (≈10 MB each) and adds only ~$150 — still a rounding error next to the token spend.

**When does free become financially dangerous?** Immediately, and it is dangerous in proportion to *engagement*, which is the perverse part. **The free plan is unsafe from the first active user**, because there is no revenue against which to net it and no server-side counter to stop it. The specific cliff is around **1,000 active users**, where the monthly burn ($3.0k) exceeds what a pre-revenue project can absorb, and it becomes existential by **10,000** ($30k/month).

---

## 11. Storage and bandwidth projections

Everything below is on the **user's** disk. Company cost is $0 at every row. The column is retained because it becomes real the moment sessions move to the cloud.

| Item | Size / min | 20-min session | 2-hour session | Retention | Deleted? | Storage cost | Egress cost |
|---|---:|---:|---:|---|---|---:|---:|
| Final video WebM (canvas + camera + mic, VP9/Opus, 1080p30) | **≈10 MB** [ASSUM] | **200 MB** | **1.20 GB** | until evicted | **Yes** — oldest dropped past 5 ([`recordings.ts:66`](lib/recordings.ts#L66)) | $0 | $0 |
| Camera recording | $0 extra — composited into the same file ([`useCanvasRecorder.ts:185`](hooks/useCanvasRecorder.ts#L185)) | — | — | — | — | $0 | $0 |
| Raw audio | $0 extra — muxed into the same WebM; no separate audio file is ever written | — | — | — | — | $0 | $0 |
| Canvas / scene JSON | ≈30 KB [measured basis: AUDIT-3 recorded a 34,420 B scene export] | 600 KB | 3.6 MB | **forever** | **No** — session library is never pruned | $0 | $0 |
| Transcript | ≈1 KB | 20 KB | 120 KB | forever | No | $0 | $0 |
| Log events | ≈4 KB | 80 KB | 480 KB | forever | No | $0 | $0 |
| Thumbnails / previews | — | — | — | — | **Do not exist** | $0 | $0 |
| Intermediate render files | — | — | — | in-memory Blob parts only, freed on `stop()` | **N/A — none written** | $0 | $0 |
| Uploaded assets | — | — | — | — | **Feature does not exist** | $0 | $0 |

**Do repeated exports create duplicate permanent files?** **No.** [CODE] PNG/SVG/`.excalidraw`/scene-JSON are regenerated on demand and streamed to a `URL.createObjectURL` that is revoked immediately ([`lib/exports.ts:142`](lib/exports.ts#L142)) or after 1 s ([`lib/recordings.ts:111`](lib/recordings.ts#L111)). The video download reuses the single stored blob. Nothing accumulates.

**Growth per active user per month** — recordings are hard-capped at 5, so the recording footprint plateaus. Canvas data grows without bound but is tiny.

| Horizon | Free (120 min/mo) | Creator (1,000 min/mo) |
|---|---:|---:|
| 1 month | 1.00 GB video (capped) + 4 MB data | 6.0 GB video (capped) + 35 MB data |
| 3 months | 1.00 GB + 12 MB | 6.0 GB + 105 MB |
| 6 months | 1.00 GB + 24 MB | 6.0 GB + 210 MB |
| 12 months | **1.00 GB + 48 MB** | **6.0 GB + 420 MB** |

**If this ever moves to cloud storage** (R2 at $0.015/GB-month, zero egress): 10,000 Creators × 6 GB = 60 TB = **$900/month**, plus operations. On S3 with standard egress the download side alone would be catastrophic. **Recommendation: if cloud sessions ship, use R2 or another zero-egress store, and keep the 5-recording cap.**

---

## 12. Cost risks and hidden multipliers

| # | Issue | Present? | Evidence | Financial risk |
|---|---|---|---|---|
| 1 | **Unauthenticated, unrate-limited API routes** | **YES** | No `middleware.ts`; no auth check in any of the 6 route handlers | **CRITICAL** |
| 2 | **`/api/deepgram/token` mints credentials to anonymous callers**, and its fallback creates real project API keys | **YES** | [`deepgram/token/route.ts:16,51`](app/api/deepgram/token/route.ts#L51) | **CRITICAL** |
| 3 | **Usage counters can be bypassed from the client — because none exist server-side** | **YES** | Zero hits for any usage/quota concept outside display strings | **CRITICAL** |
| 4 | **Whop entitlements unverified** — no webhook handler, no entitlement check, `billing.configured = false` | **YES** | [`lib/billing.ts:9`](lib/billing.ts#L9) | **CRITICAL** |
| 5 | **Repeatedly sending the full canvas state** — semantic scene JSON to Beat *and* Artist on every call | **YES** | [`beat/route.ts:93`](app/api/beat/route.ts#L93), [`artist/route.ts:33`](app/api/artist/route.ts#L33) | **HIGH** |
| 6 | **Unbounded frame history** — every diagram ever drawn re-sent to every Beat and Artist call, forever | **YES** | [`Board.tsx:461`](components/Board.tsx#L461) reads all of `framesRef`; [`:2010`](components/Board.tsx#L2010) only pushes | **HIGH** |
| 7 | **No prompt caching** — 965–1,612-token system prompts re-billed on every call | **YES** | no `cache_control` anywhere; [`lib/llm.ts:147`](lib/llm.ts#L147) | **HIGH** |
| 8 | **Multiple simultaneous sessions per user** — nothing prevents N tabs, each at full cost | **YES** | no session lock; `localStorage["inpublic-recording-active"]` only warns, and only about the recorder | **HIGH** |
| 9 | **Multiple free accounts** — sign-in accepts any string as an email, no verification | **YES** | [`lib/auth.ts:43`](lib/auth.ts#L43) | **HIGH** |
| 10 | **Account sharing** — no session binding of any kind | **YES** | same | **HIGH** |
| 11 | **Automated free-plan abuse** — the API is the product surface and it is open | **YES** | see #1 | **HIGH** |
| 12 | **Two models doing overlapping work** — Scribe letters concepts, then the Artist redraws them as diagrams; the Beat system prompt spends ~250 tokens explaining that overlap is not duplication | **YES** | [`beat/route.ts:69-83`](app/api/beat/route.ts#L69) | **HIGH** |
| 13 | **Background tabs keep spending** — `rAF` stops (video output becomes near-empty, verified in AUDIT-3) but Deepgram audio and Beat timers keep running | **YES** | keepAlive at [`useDeepgram.ts:248`](hooks/useDeepgram.ts#L248) | **MEDIUM** |
| 14 | **Processing silence and filler** — Beat fires on any >4-word buffer; `MIN_WORDS = 4` is the only filter | **YES** | [`Board.tsx:2936`](components/Board.tsx#L2936) | **MEDIUM** |
| 15 | **Excessive LLM calls from partial transcripts** — Scribe fires per Deepgram *final*, and `endpointing:150` makes finals very frequent | **YES** | [`useDeepgram.ts:213`](hooks/useDeepgram.ts#L213) | **MEDIUM** |
| 16 | **Retry without limit** — Gemini retries the whole 400'd request; Deepgram retries 12× | **PARTIAL** | [`lib/llm.ts:206`](lib/llm.ts#L206); [`useDeepgram.ts:53`](hooks/useDeepgram.ts#L53) — both bounded | **MEDIUM** |
| 17 | **Duplicate paid work after Artist failure** — pending text deliberately not retired, so the next Beat re-bills it | **YES** | [`Board.tsx:2818`](components/Board.tsx#L2818) | **MEDIUM** |
| 18 | **Race allowing allowance overrun** — there is no allowance to race against | **N/A today** | — | **CRITICAL once quotas ship** |
| 19 | **Sending the entire transcript on every update** | **NO** — bounded to 120 words (`MAX_PENDING_WORDS`) and a 90 s window (`TRANSCRIPT_WINDOW_MS`) | [`Board.tsx:155,184`](components/Board.tsx#L155) | **LOW** ✅ |
| 20 | **Autosaving too frequently** | **NO** — 3 s trailing debounce, single-flight, IndexedDB-local | [`lib/persist.ts:219`](lib/persist.ts#L219) | **LOW** ✅ |
| 21 | **Duplicate DB writes** | **NO** — two `store.put` calls in one transaction, by design | [`lib/persist.ts:73`](lib/persist.ts#L73) | **LOW** ✅ |
| 22 | **Server-side export that could be local** | **NO** — everything is already local | [`lib/exports.ts`](lib/exports.ts) | **LOW** ✅ |
| 23 | **Saving raw media no longer needed** | **NO** — 5-recording cap with oldest-first eviction | [`recordings.ts:66`](lib/recordings.ts#L66) | **LOW** ✅ |
| 24 | **Unlimited downloads / re-rendering** | **YES but free** — blob URLs, no server involvement | [`recordings.ts:103`](lib/recordings.ts#L103) | **LOW** ✅ |
| 25 | **Refunds / disputes** — $15 per dispute against $14.295 net revenue means one dispute wipes out ~2 months of a *profitable* subscriber | **YES** | Whop fee schedule | **MEDIUM** |

**Critical-tier summary:** four issues (#1–#4) share one root cause — *there is no server-side notion of a user*. Nothing can be metered, capped, entitled, or attributed until that exists. Every pricing decision in this document is unenforceable until it does.

---

## 13. Missing telemetry

**Nothing about cost is recorded, anywhere.** [CODE]

| Field | Recorded? | Where it could come from |
|---|---|---|
| Provider | ❌ | derivable from `providerFor()` — never logged |
| Model | ❌ | `SCRIBE_MODEL` etc. are in scope at every call site |
| User ID | ❌ | **does not exist** — no server-side identity |
| Project ID | ⚠️ | `sessionIdRef` exists client-side only |
| Session ID | ⚠️ | same — never sent to the server |
| **Input tokens** | ❌ | `response.usage.input_tokens` is returned by the SDK and **discarded** at [`lib/llm.ts:155`](lib/llm.ts#L155) |
| **Output tokens** | ❌ | same — `completeAnthropic` returns only text |
| Cache read / write tokens | ❌ | caching not enabled |
| Audio seconds | ❌ | Deepgram's own dashboard only; not attributable to a user |
| AI call count | ⚠️ | client-side `LogEvent`s of type `beat`/`scribe`/`actions` exist, never leave the browser |
| Retry count | ⚠️ | `scribeFailuresRef`, `attemptsRef` exist in memory; logged as free-text `note` events |
| Generated visuals | ⚠️ | `log({type:"sketch", labels})` — client-only |
| Export count | ❌ | not logged at all |
| Render duration | ⚠️ | `log({type:"timing", ...})` has `beatMs`/`organizerMs`/`applyMs` — client-only |
| Storage bytes | ⚠️ | `metadata.fileSize` on each recording — client-only |
| Download bytes | ❌ | not tracked |
| Estimated cost | ❌ | no cost model exists in code |
| Actual provider cost | ❌ | no billing-API integration |

The client already produces a **rich, well-structured timestamped event log** ([`lib/types.ts`](lib/types.ts), [`lib/sessionLog.ts`](lib/sessionLog.ts)) with `beat`, `scribe`, `timing`, `actions`, `story-timing`, and `keyterms` events. It is persisted to IndexedDB and included in exports — and it **never reaches a server**. This is the closest thing to a telemetry foundation that exists, and it is 90% of the way to being useful.

**The single cheapest telemetry win:** `lib/llm.ts` already receives `response.usage` from the Anthropic SDK on every call and throws it away. Returning it and logging it would give exact per-call token counts for free, with no measurement error.

---

## 14. Recommended cost-ledger design

**Design intent:** one immutable row per billable provider event, written server-side, joinable to user / session / project, with both an estimated cost (computed at write time from a versioned price table) and a slot for the provider's later reconciled figure. No implementation was done.

```sql
-- ── identity (prerequisite: none of this works without a real user) ──────────
CREATE TABLE app_user (
  user_id            uuid PRIMARY KEY,
  email              citext UNIQUE NOT NULL,
  email_verified_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  plan               text NOT NULL DEFAULT 'free',      -- free | creator
  whop_membership_id text UNIQUE,                        -- verified via webhook
  entitlement_valid_until timestamptz,
  risk_flags         jsonb NOT NULL DEFAULT '{}'
);

-- ── the price table: never hardcode a rate in application code ───────────────
CREATE TABLE price_book (
  price_id        bigserial PRIMARY KEY,
  provider        text NOT NULL,        -- anthropic | google | deepgram | vercel | whop
  resource        text NOT NULL,        -- claude-haiku-4-5 | nova-3-streaming | ...
  unit            text NOT NULL,        -- input_token | output_token | cache_read_token
                                        -- | audio_second | gb_hour | gb_egress | invocation
  usd_per_unit    numeric(18,12) NOT NULL,
  effective_from  timestamptz NOT NULL,
  effective_to    timestamptz,
  source_url      text NOT NULL,
  verified_at     timestamptz NOT NULL,
  UNIQUE (provider, resource, unit, effective_from)
);

-- ── session envelope: one row per recording take ────────────────────────────
CREATE TABLE usage_session (
  session_id        uuid PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES app_user,
  project_id        uuid,
  mode              text NOT NULL,          -- standard | story
  engine            text NOT NULL,          -- deepgram | gemini
  camera_enabled    boolean NOT NULL,
  client_fingerprint text,                  -- concurrent-session and sharing detection
  started_at        timestamptz NOT NULL,
  ended_at          timestamptz,
  end_reason        text,                   -- user_stop | cap_reached | disconnect | abandoned
  wall_seconds      integer,                -- mic open
  speech_seconds    integer,                -- ← the billable unit; see §"billing unit"
  billed_minutes    integer,                -- what we charged the allowance
  final_count       integer,
  frames_drawn      integer,
  concurrent_peer_sessions smallint,        -- >0 = multi-tab
  est_cost_usd      numeric(12,6),          -- denormalised rollup of the ledger
  CHECK (speech_seconds <= wall_seconds)
);

-- ── THE LEDGER: one immutable row per paid provider event ───────────────────
CREATE TABLE cost_ledger (
  event_id          bigserial PRIMARY KEY,
  occurred_at       timestamptz NOT NULL,
  user_id           uuid NOT NULL REFERENCES app_user,
  session_id        uuid REFERENCES usage_session,
  project_id        uuid,

  feature           text NOT NULL,          -- scribe | beat | artist | story
                                            -- | stt | stt_token_mint | fn_compute | egress | payment
  provider          text NOT NULL,
  model             text,                   -- claude-haiku-4-5 | claude-sonnet-4-6 | nova-3
  api_endpoint      text,                   -- /v1/messages | /v1/listen

  input_tokens        integer,
  output_tokens       integer,
  cache_read_tokens   integer,
  cache_write_tokens  integer,
  audio_seconds       numeric(10,2),
  fn_gb_seconds       numeric(12,4),
  egress_bytes        bigint,
  storage_bytes_delta bigint,

  request_count     smallint NOT NULL DEFAULT 1,
  retry_count       smallint NOT NULL DEFAULT 0,
  is_retry          boolean  NOT NULL DEFAULT false,
  outcome           text NOT NULL,          -- ok | parse_failure | upstream_error | aborted | refused
  latency_ms        integer,

  visuals_generated smallint,               -- ops applied to the canvas
  render_ms         integer,

  est_cost_usd      numeric(12,8) NOT NULL, -- computed at write time from price_book
  price_id          bigint REFERENCES price_book,
  actual_cost_usd   numeric(12,8),          -- reconciled from the provider's billing API
  reconciled_at     timestamptz
);

CREATE INDEX ON cost_ledger (user_id, occurred_at DESC);
CREATE INDEX ON cost_ledger (session_id);
CREATE INDEX ON cost_ledger (feature, occurred_at DESC);
CREATE INDEX ON cost_ledger (occurred_at) WHERE actual_cost_usd IS NULL;

-- ── client-side events (exports, downloads): reported, not trusted ──────────
CREATE TABLE client_event (
  event_id     bigserial PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES app_user,
  session_id   uuid,
  kind         text NOT NULL,     -- export_png | export_video | recording_saved | replay
  bytes        bigint,
  occurred_at  timestamptz NOT NULL,
  reported_at  timestamptz NOT NULL DEFAULT now()
);

-- ── the enforceable allowance (authoritative; the client never decides) ─────
CREATE TABLE usage_period (
  user_id            uuid NOT NULL REFERENCES app_user,
  period_start       date NOT NULL,
  plan               text NOT NULL,
  minutes_allowed    integer NOT NULL,
  minutes_consumed   integer NOT NULL DEFAULT 0,
  est_cost_usd       numeric(12,4) NOT NULL DEFAULT 0,
  hard_capped_at     timestamptz,
  PRIMARY KEY (user_id, period_start)
);

-- ── payments, so revenue and cost live in the same place ────────────────────
CREATE TABLE payment_event (
  payment_id       text PRIMARY KEY,        -- Whop id
  user_id          uuid NOT NULL REFERENCES app_user,
  kind             text NOT NULL,           -- charge | refund | dispute | affiliate_payout
  gross_usd        numeric(10,2) NOT NULL,
  processing_fee_usd numeric(10,2) NOT NULL,
  affiliate_fee_usd  numeric(10,2) NOT NULL DEFAULT 0,
  affiliate_commission_usd numeric(10,2) NOT NULL DEFAULT 0,
  net_usd          numeric(10,2) NOT NULL,
  occurred_at      timestamptz NOT NULL
);
```

### The six questions the ledger must answer

| Question | Query |
|---|---|
| How much did this user cost today? | `SELECT sum(coalesce(actual_cost_usd, est_cost_usd)) FROM cost_ledger WHERE user_id=$1 AND occurred_at >= current_date` |
| How much did this session cost? | same, `WHERE session_id=$1`; or read the denormalised `usage_session.est_cost_usd` |
| What feature creates the most cost? | `SELECT feature, model, sum(est_cost_usd), count(*) FROM cost_ledger WHERE occurred_at > now()-interval '7 days' GROUP BY 1,2 ORDER BY 3 DESC` |
| What does one visual-speech minute cost? | `SELECT sum(l.est_cost_usd) / (sum(s.speech_seconds)/60.0) FROM cost_ledger l JOIN usage_session s USING (session_id)` — segment by `s.mode` and by `ntile(10) OVER (ORDER BY s.wall_seconds)` to expose the session-length growth curve |
| Are free users subsidised sustainably? | join `cost_ledger` to `app_user.plan` and `payment_event`: `sum(net_usd) FILTER (plan='creator') - sum(est_cost_usd)` per cohort-month |
| Which users/sessions are abnormal? | rank `cost_ledger` by user-day cost and flag >p99; separately flag `usage_session.concurrent_peer_sessions > 0`, `retry_count` outliers, and `speech_seconds/wall_seconds < 0.15` (idle-mic burn) |

**Write path:** the four route handlers already have every field in scope. Return `response.usage` from `lib/llm.ts` instead of discarding it, and write one ledger row per handler invocation. Deepgram audio seconds come from a session heartbeat plus a reconciliation job against Deepgram's usage API.

---

## 15. Pricing and allowance recommendations

### 15.1 Ship-blockers — do these before any public pricing commitment

1. **Real server-side identity.** Everything else depends on it. Nothing can be metered without it.
2. **Authenticate every API route** and add per-user rate limits. Today they are open to the internet.
3. **Verify Whop entitlements server-side** via webhook, and gate `plan` on the verified membership — never on a client claim.
4. **Server-authoritative minute counter** with a hard cap. The cap must be enforced where the tokens are spent (the route handler), not in the UI.
5. **Ship the cost ledger** (§14) *before* pricing, not after.

### 15.2 Cost reductions available in the current architecture

Ranked by impact-per-effort. All estimates are [CALC] against the §4 model.

| # | Change | Effect on $/min | Notes |
|---|---|---:|---|
| 1 | **Prompt caching** on the four system prompts (`cache_control: ephemeral`) | **−$0.0105/min (−19%)** | Beat + Artist + Scribe system prompts are stable prefixes. Cache reads are ~0.1× input price. Note: Haiku 4.5's minimum cacheable prefix is **4,096 tokens** — the 1,190-token `BEAT_SYSTEM` alone will *not* cache. Restructure so tools + system + the stable scene prefix exceed 4,096 together, or move the Beat to a model with a lower minimum. |
| 2 | **Prune the frame history** — cap `sceneSummary()` at the most recent ~12 frames | **eliminates the entire growth term**; a 120-min session drops from $11.96 → **$6.47 (−46%)** | One-line change in spirit; `framesRef.current.slice(-12)` at [`Board.tsx:461`](components/Board.tsx#L461). This is the highest-value single change in the codebase. |
| 3 | **Move the Artist off Sonnet 4.6** to Haiku 4.5, or gate Sonnet to structurally hard draws | **−$0.0187/min (−34%)** | Sonnet is 42% of the per-minute cost at 1.4 calls/min. AUDIT-3 measured it at 3.6–4.4 s, already the dominant latency too — so this improves the product *and* the margin. Requires a quality eval. |
| 4 | **Raise `SCRIBE_INTERVAL_MS` 700 → 1,400 ms** | −$0.005/min (−9%) | The comment at [`Board.tsx:160`](components/Board.tsx#L160) records this was *lowered* from 1,400 for feel. A direct quality/cost trade — the user's call, not mine. |
| 5 | **Idle-mic auto-stop** — pause the Deepgram socket after ~90 s with no final | −$0.0048/min while idle | Also stops billing minutes the user did not knowingly spend. |
| 6 | **Cut the Beat entirely** — fold the draw/skip decision into the Scribe's output | −$0.0166/min (−31%) | Larger refactor; the Beat's whole job is a 6-way classification. |
| 7 | **Suppress work in backgrounded tabs** — `visibilitychange` → pause | prevents 100% waste | AUDIT-3 verified the video output is empty in a hidden tab anyway. |

**Applying #1 + #2 + #3 together:** per-minute cost falls from **$0.062 → ~$0.019** (a 69% reduction), and a 20-min session from $1.23 → **$0.38**. That changes the answer to the pricing question completely.

### 15.3 Allowance recommendations

**A — ship now, on the current implementation** (cost $0.062/min):

| Plan | Price | Minutes | Max session | Cost at full use | Net revenue | **GM at full use** |
|---|---:|---:|---:|---:|---:|---:|
| Free | $0 | **30** | 20 min | $1.85 | $0 | — |
| Creator | **$19** | **250** | 60 min | $15.39 | $18.19 | **+15.4%** |

At 30% average Creator utilisation this yields a healthy **75% blended margin**, and one Creator supports **~4 fully-active free users**. Conservative, honest, survivable.

**B — after the §15.2 cost work** (cost ≈$0.019/min):

| Plan | Price | Minutes | Max session | Cost at full use | Net revenue | **GM at full use** |
|---|---:|---:|---:|---:|---:|---:|
| Free | $0 | **90** | 20 min | $1.71 | $0 | — |
| Creator | **$15** | **600** | 2 hours | $11.40 | $14.295 | **+20.2%** |

**C — the proposed pricing, made safe.** If 120 free minutes and 1,000 Creator minutes are non-negotiable brand commitments, the only honest way to ship them is:

- Do all of §15.2 (gets cost to ~$0.019/min), **and**
- Price Creator at **$29/month** (net $27.92; 1,000 min costs $19.00 → **32% GM**), **and**
- Make **Story Mode the default** for long sessions — it is 2.5× cheaper and is also the better product for the use case, **and**
- Accept that Free at 120 min costs **$2.28/user/month** even after optimisation, so it needs a **1:5 or better** paid ratio.

I would not ship 1,000 minutes at $15 under any configuration I can model.

### 15.4 On "identical intelligence and export quality on both plans"

**Keep it. It costs almost nothing to honour, and it is the most defensible thing about the product.**

[CODE] Export quality is entirely client-side — same code path for everyone, zero marginal cost. Story Mode and camera are free. The *only* thing that differs by cost is minutes and the Sonnet Artist, and if recommendation #3 moves the Artist to Haiku, both plans get the same model anyway. The principle and the economics point the same direction here: **charge for time, give everyone the same product.** That is exactly what the stated principle says. The problem is not the principle — it is the numbers attached to it.

---

## 16. Unknowns requiring production measurement

| # | Unknown | Why it matters | How to close it |
|---|---|---|---|
| 1 | **Beat draw-rate** (I assumed 25%) | Directly scales the Sonnet line, 42% of cost. If the true rate is 40%, cost per minute rises 24%. | Count `beat.action != 'skip'` over 7 days of the client log. |
| 2 | **Actual input/output tokens per call** | Every token figure in §4.3 is a structured estimate from field caps. Could be ±40%. | Return and log `response.usage`. Zero measurement error, one afternoon of work. |
| 3 | **Real Scribe rate after throttle/coalescing** | I assumed 7/min from 8.3 finals/min. | Count `type:"scribe"` log events per minute. |
| 4 | **Real session-length distribution** | The growth term means a 2-hour take costs 8.6× a 20-min take for 6× the minutes. The mix determines everything. | Histogram of `usage_session.wall_seconds`. |
| 5 | **Speech-to-wall-clock ratio** | Determines whether the billing unit should be wall-clock or speech. | `speech_seconds / wall_seconds` per session. |
| 6 | **True WebM bitrate** for real composited canvas + camera | My 10 MB/min is [ASSUM]. The one real artifact (110 KB) came from a throttled tab and is unrepresentative. | Record 5 real 10-min sessions, measure `blob.size`. |
| 7 | **Conversion rate free→paid** | I assumed 3%. Every scale figure in §10 scales with it. | Measure after launch. |
| 8 | **Whop's 3% Discord/Telegram platform fee applicability** | Would cut net revenue from $14.295 to $13.845. | Ask Whop directly. |
| 9 | **Dispute/refund rate** | At $15/dispute this is material for a $15 product. | Whop dashboard after 90 days. |
| 10 | **Deepgram tier** | Growth tier is 12.5% cheaper. Threshold not verified. | Deepgram sales. |
| 11 | **Bundle size and cold-start cost on Vercel** | Excalidraw is large; first-load bandwidth was not measured. | `next build` analyze + Vercel usage dashboard. |
| 12 | **Whether prompt caching is achievable at all on Haiku 4.5** | Its 4,096-token minimum prefix exceeds every system prompt here. | Test with a padded/restructured prefix; measure `cache_read_input_tokens`. |

---

## 17. Seven-day measurement plan

**Precondition:** none of this requires shipping identity or billing. All of it is instrumentation. Do it before committing publicly to any price.

**Day 1 — make the LLM calls self-reporting.**
Change `complete()` and `completeStream()` in `lib/llm.ts` to return `{text, usage}` instead of a bare string, and have each of the four route handlers `console.log` one structured JSON line: `{ts, feature, model, input_tokens, output_tokens, latency_ms, outcome}`. Read it off Vercel's function logs. No database needed yet. **This alone closes unknowns #2 and #3 and removes the largest error bar in this report.**

**Day 2 — ship the client log to the server.**
Add one `POST /api/telemetry` that accepts the existing `LogEvent[]` batch on session end. It already contains `beat`, `scribe`, `timing`, `actions`, and `story-timing`. Store as JSONL. Closes unknowns #1 and #4.

**Day 3 — instrument the session envelope.**
Emit `session_start` / `session_end` with `wall_seconds`, `speech_seconds` (sum of Deepgram final durations — the data is already in `handleFinal`), `mode`, `camera_enabled`, `frames_drawn`, and a random client id. Closes #5.

**Day 4 — measure media and bundle.**
Record five real 10-minute sessions on real hardware, camera on and off, and log `blob.size` and `durationMs` from the existing `RecordingMetadata`. Run `next build` with bundle analysis and pull first-load transfer from Vercel. Closes #6 and #11.

**Day 5 — test prompt caching.**
Add `cache_control` to `BEAT_SYSTEM` on a branch and check `usage.cache_read_input_tokens` across ten consecutive beats. If it stays zero (likely — Haiku 4.5 needs a 4,096-token prefix), test the same with the scene JSON inside the cached prefix, and test the Artist on Sonnet 4.6 (1,024-token minimum, which `ARTIST_SYSTEM` + tools should clear). Closes #12 and sizes recommendation §15.2 #1.

**Day 6 — commercial confirmations.**
Email Whop: does the 3% platform fee apply to a standalone web app with no Discord/Telegram gating; what is the observed dispute rate on $15 creator-tool subscriptions. Email Deepgram: Growth-tier volume threshold, and whether nova-3 monolingual is the correct model for the current config. Closes #8 and #10.

**Day 7 — recompute and decide.**
Rebuild §4's formula from the measured numbers. Produce three curves — measured-today, with-frame-pruning, and with-caching-plus-Haiku-Artist — and pick the allowance tier from §15 that the measured curve actually supports. Publish pricing only after this step.

**What "success" looks like on day 7:** a single measured number for cost per visual-speech minute with a confidence interval under ±15%, segmented by mode and by session-length decile, and a decision on the allowance made from that number rather than from this document's estimates.

---

## Direct answers

**Is 120 free minutes per month financially safe?**
**No.** It costs **$7.40 per fully-active free user per month**, against $0 revenue, with no server-side cap to stop it and no authentication to prevent unlimited free accounts. A Creator at realistic utilisation generates *negative* surplus, so free users are not subsidised by anything — they are funded from capital. 30 free minutes ($1.85) is defensible today; 90 minutes becomes defensible after the §15.2 cost work.

**Is 1,000 Creator minutes for $15 financially safe?**
**No, by a factor of 4.3× to 6.9×.** Full consumption costs **$61.55–$98.41** against **$14.295** net revenue — a gross margin of **−331% to −595%**. Break-even is 232 minutes. The plan loses money from **250 minutes onward**, i.e. at 25% utilisation. Even a light-usage distribution blends to **+4.2%** gross margin, which does not fund a business.

**Can both plans receive identical AI and video quality?**
**Yes — and this is the one part of the plan I would not change.** Video, camera, exports, storage, and downloads are 100% client-side and cost $0 regardless of plan ([`useCanvasRecorder.ts`](hooks/useCanvasRecorder.ts), [`lib/exports.ts`](lib/exports.ts), [`lib/recordings.ts`](lib/recordings.ts)). Identical AI quality costs nothing *extra* either — the model choice is per-call, not per-plan. The differentiator should be time, exactly as the stated principle says.

**What is the estimated average cost of one visual-speech minute?**
**$0.065.** Standard Mode averages $0.0616/min over a 20-minute session and $0.0996/min over a two-hour session; Story Mode averages $0.027–$0.036/min. [CALC, with the token estimates in §4.3 as the dominant error term — ±30% until Day 1 of §17 is done.]

**What is the plausible worst-case cost of one visual-speech minute?**
**$0.51/min** — the marginal cost of minute 120 of a high-intensity two-hour Standard Mode session with the Artist emitting its full 1,200-token budget. Such a session costs **$39.03**, which is 2.6× the monthly subscription price. Averaged over that session, $0.33/min.

**How many fully active free users can one Creator subscriber support?**
**One — and only if that Creator uses ≤100 minutes.** At 10% Creator utilisation the surplus is $7.44 against a fully-active free user's $7.38. At 25% Creator utilisation the surplus is negative and the answer is **zero**. The proposed 1:10, 1:20 and 1:50 ratios are not achievable at any tested utilisation level.

**What usage limit would preserve at least a 70% gross margin?**
**70 minutes per month at $15**, with no affiliate. **47 minutes** with a 30% recurring affiliate commission. **25 minutes** with a 60% commission. After the §15.2 cost reductions (≈$0.019/min), 70% margin supports **225 minutes** at $15, or **1,000 minutes at $47/month**.

**What is the largest financial risk in the current implementation?**
**The API routes are unauthenticated, unmetered, and publicly reachable.** `GET /api/deepgram/token` hands a live Deepgram credential to any anonymous caller and, on the fallback path, creates a real project API key ([`app/api/deepgram/token/route.ts:16,51`](app/api/deepgram/token/route.ts#L51)); `POST /api/artist` spends Claude Sonnet 4.6 tokens for anyone who asks. There is no `middleware.ts`, no rate limit, no origin check, no user record, and no usage counter anywhere in the repository. The pricing problem is a slow bleed measured in dollars per user per month; this one is unbounded and could be exploited in an afternoon. **It is also the blocker for everything else — no allowance in this document is enforceable until a server-side user exists.**

**What should be measured before publicly committing to this pricing?**
In priority order: **(1)** real input/output token counts per call — `response.usage` is already returned by the SDK and discarded at [`lib/llm.ts:155`](lib/llm.ts#L155), so this is nearly free and removes the largest error bar in this report; **(2)** the Beat's actual draw-rate, which scales the Sonnet line; **(3)** the session-length distribution, because cost grows quadratically with session length; **(4)** the speech-to-wall-clock ratio, which decides the billing unit; **(5)** whether prompt caching is achievable on Haiku 4.5 given its 4,096-token minimum prefix. §17 closes all five inside a week without shipping a single product change.

---

## Appendix — the billing unit

Six candidate definitions of "one visual-speech minute", scored against how closely each tracks real cost:

| Candidate | Tracks cost? | Understandable? | Gameable? | Verdict |
|---|---|---|---|---|
| Minute with the session open | Poorly — an open tab with no speech costs $0.0048/min but bills a full minute | Very | Punishes the user for our idleness | ❌ |
| Minute of microphone input | Same as above; identical in this implementation | Very | Same | ❌ |
| **Minute in which speech is detected** | **Well — Scribe, Beat and Artist all fire off transcript finals, which only exist when there is speech** | **Very** | Hard — requires actually speaking | ✅ **Recommend** |
| Minute of transcribed audio | Very well, but Deepgram's `duration` sums to less than wall-clock and the difference confuses people | Poorly | Hard | ⚠️ |
| Minute of AI processing | Best cost fidelity, but it is invisible to the user and varies with our own model choices | Not at all | Hard | ❌ |
| Minute of exported video | Tracks nothing — exports are free and many sessions are never exported | Very | Trivially | ❌ |

**Recommendation: one visual-speech minute = one clock minute during which at least one transcript final was produced.** It is the closest cheap proxy to actual cost (every paid LLM call in Standard Mode is downstream of a final), it is trivially explainable ("a minute in which you spoke"), and it is measured server-side from data the pipeline already produces.

### Can minutes be wrongly consumed?

| Situation | Consumes a minute today? | Should it? |
|---|---|---|
| **Silence with mic open** | Costs $0.0048/min in Deepgram, produces no finals | **No** — under the recommended unit, correctly free. But add an idle auto-stop so we stop paying too. |
| **Paused recording** | `recorder.pause()` stops the *video* only ([`useCanvasRecorder.ts:330`](hooks/useCanvasRecorder.ts#L330)); the Deepgram socket keeps streaming and the Beat keeps firing | **No** — pause must also suspend the STT socket. This is a real bug in the making. |
| **Background tab** | Deepgram streams, Beats fire, `rAF` stops so the video is near-empty (verified in AUDIT-3) | **No** — full cost, no product. Suspend on `visibilitychange`. |
| **Reconnects** | Up to 12 attempts; the same `MediaStream` is reused so audio is not duplicated | **No** — correctly handled today ✅ |
| **Failed sessions** | An Artist failure leaves the pending text un-retired, so the next Beat re-bills the same words | **No** — but it does cost us twice. |
| **Retries** | Gemini path retries a 400'd request whole (double-billed); Anthropic path does not retry | **No** |
| **Reopening a saved project** | Pure IndexedDB read, no network, no models | **No** — correctly free ✅ |
| **Replaying / re-downloading** | Blob URL, no network | **No** — correctly free ✅ |
| **Two tabs open at once** | Both consume in full, nothing prevents it | **Yes, both should count** — and today neither is counted at all. |

The encouraging finding: under the recommended billing unit, **most of these are already correct by construction**, because cost is genuinely driven by speech events. The two that need code are pause-should-suspend-STT and background-tab suspension — and both are cost *savings*, not just accounting fixes.
