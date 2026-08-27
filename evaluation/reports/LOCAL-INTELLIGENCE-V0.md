# Local Intelligence Stack V0

Evaluation of whether InPublic's speech → visual expression pipeline can run
entirely on local inference (Ollama qwen3:4b + a fresh Moonshine bridge)
instead of Anthropic/Google/Deepgram, without redesigning any existing
architecture. Per the spec, this stops at establishing a trustworthy local
baseline — the tension/comparison grammar bias and recomposition gaps the
baseline surfaces are reported, not fixed.

## Checkpoint

- Branch: `expression-engine-default`
- SHA at time of this work: `552bda01b32c901db9cf501835f86e3390c320a8`
- Ollama: `0.33.1`, installed via winget this session
- Models pulled: `qwen3:4b` (default), `qwen3:1.7b` (comparison only)
- Hardware: CPU-only inference (`ollama ps` reports `100% CPU` — no GPU offload on this machine), which is the single biggest factor in every latency number below.

## 1. Provider architecture

`lib/llm.ts` was already a single provider seam (`complete`/`completeStream`) used by every LLM caller in the codebase (`lib/agent/model.ts`, `lib/communicator/model.ts`, `lib/communicator/shape.ts`, `lib/expression/meaning/extract.ts`) — no caller ever constructed a provider client itself. Adding Ollama meant extending that seam, not bypassing it:

- `LLM_PROVIDER=ollama` short-circuits `providerFor()` to `"ollama"` regardless of which role model string (`ARTIST_MODEL`, `SCRIBE_MODEL`, etc.) the caller passed — every call goes to one local model (`OLLAMA_MODEL`, default `qwen3:4b`) at `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`). This is a full backend swap, matching the spec's framing, not a per-role local model split.
- `completeOllama`/`completeStreamOllama` call Ollama's `/api/chat`. A `fetchImpl` option (test-only DI, mirrors the existing `createScriptedDecisionProvider` pattern in `lib/agent/decide.ts`) lets `scripts/llm-provider-test.mjs` exercise the request/response shape without a real server.
- Failure behavior: an unreachable Ollama server throws `LocalProviderUnavailableError` and **does not** silently fall back to a paid provider. A fallback only happens if `OLLAMA_ALLOW_FALLBACK=1` is explicitly set — verified in `scripts/llm-provider-test.mjs` by asserting the specific error type survives (a wrongly-attempted fallback would instead throw Anthropic's own "no API key" error).
- The Supabase-backed cost/rate-limit guard (`lib/server/provider-guard.ts`) has no `provider_rate_cards` row for a free local model and was never meant to protect zero-cost local calls, so the three model-calling routes (`app/api/agent/decision`, `app/api/express`, `app/api/sketch`) skip the guard entirely when `providerFor(model) === "ollama"`, while every other check (auth, rate limits, billing) is untouched for the cloud paths.

## 2. Structured output

`zod-to-json-schema` converts each caller's existing zod schema (`AgentDecisionSchema`, `CommunicationDecisionSchema`, `MeaningDeltaSchema`) into Ollama's `format` parameter, so the local model is decoding against a real JSON schema instead of free text. **The existing zod `.safeParse` validation is completely unchanged and remains the actual trust boundary** — `format` only assists the model, per the spec's explicit instruction not to weaken validation.

**A real bug found and fixed during this work**: qwen3:4b (a reasoning model) inlines its chain-of-thought as a literal `<think>...</think>` block at the start of `message.content`, even with `think: false` sent in the request — Ollama's separate `message.thinking` field was not populated on this build, so `extractMeaning` was silently returning the empty-fallback delta on every real call (the JSON parser found no `{` before the `<think>` tag's prose). Fixed by stripping a leading `<think>...</think>` block from Ollama's response in `lib/llm.ts` before it reaches the JSON extractor, regardless of whether the `think` flag was honored. Covered by `scripts/llm-provider-test.mjs`. This is worth flagging for anyone reusing this pattern with other reasoning models in Ollama — the failure mode is silent (a valid-looking empty result, not an error).

## 3. Moonshine bridge

No `moonshine-voice` project existed anywhere on this machine or in sibling folders, so it was built fresh: `local/moonshine-bridge/` (Python, `useful-moonshine` + `websockets` + `sounddevice`). It owns the microphone directly — unlike Deepgram, audio never enters the browser. A small RMS-energy VAD segments the mic stream into lines, periodically re-transcribing the growing buffer for "line_changed" and finalizing on a silence hangover for "line_completed" — moonshine's public API (`moonshine.transcribe`) is whole-segment, not a token-streaming API, so this is Useful Sensors' own `live_captions` demo pattern, not real streaming ASR. See `local/moonshine-bridge/README.md` for the full protocol and known limitations.

`hooks/useMoonshine.ts` (thin React wrapper) and `lib/moonshineBridge.ts` (the actual connection/backoff/normalization logic, unit tested in `scripts/moonshine-bridge-test.mjs` with a fake socket) plug into `components/Board.tsx`'s existing `ENGINE` toggle exactly the way `useGeminiLive` already does (`NEXT_PUBLIC_ENGINE=moonshine`) — `lib/liveSpeech.ts` needed zero changes, since it already only consumes plain interim/final text regardless of source.

**Transcript-event mapping**: `line_started`/`line_changed` → interim, `line_completed` → final (`lib/moonshineBridge.ts`'s `normalizeMoonshineEvent`), matching Deepgram's split exactly.

## 4. Local end-to-end result

`scripts/local-e2e-eval.mjs` (`RUN_LOCAL_E2E=1`) confirmed, against the real installed stack:

```
✓ Ollama is reachable — models: qwen3:1.7b, qwen3:4b
✓ Moonshine bridge process exits cleanly
✓ Moonshine bridge emits at least one line_started and one line_completed event
✓ extractMeaning runs against Ollama without throwing
✓ the extracted delta validates against MeaningDeltaSchema
✓ the delta contains real extracted content, not the empty-fallback (proves Ollama was actually reached)
✓ decideWithCommunicatorModel runs against Ollama without throwing
✓ the communicator decision validates against CommunicationDecisionSchema
✓ zero remote (Anthropic/Google) calls occurred — remoteCallCount=0
```

All 9 checks passed. `extractMeaning("Traffic increased from 200 to 500 while conversion stayed flat.")` against qwen3:4b correctly produced a `traffic` metric entity with both points — real, correct extraction, not a fallback.

**Important scope note**: the Moonshine half of this check used a synthetic tone (no microphone in this environment), so it proves the process starts, segments audio, and emits well-formed events — not transcription accuracy. The Ollama half used a fixed real sentence, independent of whatever (if anything) the synthetic tone produced.

## 5. Self-Expressive-Agent-V0: qwen3:4b vs. the existing cloud baseline

Same three scenarios, same prompts, same harness (`scripts/self-expressive-agent-v0-eval.mjs`) — only `LLM_PROVIDER=ollama` changed. Raw traces: `self-expressive-agent-v0-raw.json` (cloud: Sonnet 4.6 decisions, Haiku 4.5 shaping) vs. `self-expressive-agent-v0-raw-ollama.json` (qwen3:4b for both).

| | Cloud (Sonnet 4.6 / Haiku 4.5) | Local (qwen3:4b) |
|---|---|---|
| demo1 (AI startup trade-off) | **completed**, 2 decision + 1 shaping calls, grammar `comparison` | **stalled** ("repeated spoken without canvas change"), 2 decision calls, **never visualized at all** |
| demo2 (silent teams) | **completed**, 2 decision + 1 shaping calls, grammar `process` | **stalled**, 4 decision + 1 shaping calls, one `recompose` applied → grammar `comparison`, then looped on identical speech |
| demo3 (speed vs. accuracy) | **completed**, 2 decision + 1 shaping calls, grammar `cause_effect` | **stalled**, 4 decision + 2 shaping calls, two `recompose` steps (both → grammar `comparison`), then looped on identical speech |
| Total model calls | 9 | 13 |
| Total input/output tokens | 10,531 / 1,819 | 14,233 / 1,675 |

The cost figures the eval script prints for the Ollama run (~$0.05) are an artifact of the script's cost table matching by the *label* of the role model constant (`COMMUNICATOR_MODEL` still reads `"claude-sonnet-4-6"` as a string even though `LLM_PROVIDER=ollama` routes the actual call elsewhere) — the real cost of every one of these 13 calls was **$0.00**, run entirely on local hardware.

**What this shows**:
- The cloud baseline in this repo's current state already produces diverse grammars (`comparison`, `process`, `cause_effect`) across the three scenarios — a healthier picture than the `tension`-for-everything result an earlier run of this same harness had surfaced (see `planning/specs/SELF-EXPRESSIVE-AGENT-V0.md`'s "Known Limitations"), so that specific bias may already be improved on this branch independent of anything in this local-stack work.
- qwen3:4b reproduces the **same underlying grammar-collapse pattern** that motivated that known limitation: every scenario it did visualize resolved to grammar `comparison`, regardless of the requested form.
- qwen3:4b's clearest, distinct new failure mode is **loop self-regulation**, not grammar choice: all three scenarios ended `stalled` because the model repeated the exact same `speak` message verbatim after already saying it, instead of recognizing the point was made and returning `done`. The cloud model never did this in this run. demo1 is the sharpest case — qwen3:4b never chose to visualize at all, where the cloud model always did.

This is exactly the kind of measured difference the spec asked for: not "is qwen3:4b as good as Sonnet," but "is it good enough to iterate on locally" — see Q6 below.

## 6. Ollama model comparison: qwen3:4b vs. qwen3:1.7b

`scripts/ollama-model-comparison-eval.mjs` (`RUN_OLLAMA_MODEL_COMPARISON=1`), one call per real call shape, both models actually installed (never auto-pulled):

| Call shape | qwen3:4b total ms | qwen3:1.7b total ms | Both schema-valid? |
|---|---|---|---|
| expression_extract | 77,364 | 55,354 | ✓ / ✓ |
| communicator_decision | 9,235 | 6,716 | ✓ / ✓ |
| communicator_shaping | 34,536 | 28,243 | ✓ / ✓ |
| agent_decision | 34,840 | 19,094 | ✓ / ✓ |

qwen3:1.7b was 28–45% faster on every call shape in this single-sample run and produced schema-valid output every time, same as qwen3:4b. Full token/duration breakdown in `evaluation/reports/ollama-model-comparison-raw.json`. Both models shared the same semantic quirk on `agent_decision` (inventing a relation target — `"canvas"` for 4b, a second unstated entity for 1.7b — that wasn't declared as an entity in the same delta), so this isn't a size-related regression; it's a shared prompt/grammar gap worth a follow-up eval, not something fixed here per the "don't redesign" stop condition.

This is a single-prompt-per-shape comparison, not a statistically powered benchmark — treat it as a first data point, not a verdict.

## Known local-quality gaps

- **No real Moonshine accuracy measurement.** This environment has no microphone; the local e2e check used a synthetic tone. Real accuracy — especially natural Trinidad/Tobago speech per the spec's explicit ask — requires a human running `local/moonshine-bridge/server.py` with a live mic and comparing against Deepgram on the same audio. The harness and protocol are built; the measurement is not.
- **qwen3:4b's loop self-regulation is the weakest link found**, not raw extraction/decision quality (which was schema-valid and semantically reasonable throughout). This is the concrete thing to watch if iterating locally on `lib/communicator/`.
- **CPU-only inference is slow** (single extraction call: 55–77s). A GPU-backed machine would materially change the "good enough for rapid local experimentation" answer below.
- The `<think>`-stripping fix in `lib/llm.ts` was validated against qwen3:4b/qwen3:1.7b on this Ollama build; a different reasoning model might use a different inline marker.

## Answers

1. **Can InPublic run speech → visual expression without a remote inference API?** Yes for the LLM half (verified end to end, zero remote calls, real extraction). The Moonshine half is built and produces well-formed events, but the audio-accuracy claim is unverified in this environment (no mic).
2. **Can the Self-Expressive Agent run entirely on Ollama?** Yes, mechanically — all 13 calls across 3 scenarios completed, all schema-valid. Behaviorally, no scenario reached `completed`; all three `stalled` on repeated speech, and one never visualized.
3. **Are strict structured decisions still validated?** Yes, unchanged. `format`-guided JSON is still just a decoding aid; the same zod schemas are still the only gate, exactly as required.
4. **Does Moonshine provide usable interim/completed speech events?** The plumbing does (verified with a synthetic signal); usability on real, especially accented, speech is unmeasured here.
5. **Can development occur without consuming Anthropic or Deepgram credits?** Yes for the LLM path, confirmed by a real zero-remote-calls assertion in code, not just observation.
6. **Is `qwen3:4b` good enough for rapid local experimentation?** Conditionally yes, with a specific caveat: it correctly extracts meaning and produces valid decisions/shapes, so it's good enough to iterate on prompts, schemas, and the deterministic layers below the model boundary. It is **not** yet good enough to evaluate loop-completion behavior locally with confidence, since its stalling pattern differs qualitatively from the cloud model's — a "the loop worked" observation on qwen3:4b needs a cloud rerun before trusting it, and vice versa. qwen3:1.7b traded meaningful speed for no observed quality loss in this small sample and is worth using as the faster default for quick iteration, with qwen3:4b as a second opinion.
