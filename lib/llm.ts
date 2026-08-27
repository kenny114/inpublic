import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Thin provider shim. Model id decides the provider: anything starting with
 * "gemini" goes to Google, everything else to Anthropic — unless
 * `LLM_PROVIDER=ollama` is set, in which case every call is routed to a local
 * Ollama server instead, regardless of which model id the caller passed, or
 * `LLM_PROVIDER=groq`/`LLM_PROVIDER=nvidia` is set, in which case every call
 * is routed to that hosted API instead. GROQ_ALLOW_FALLBACK=1 /
 * NVIDIA_ALLOW_FALLBACK=1 let a rate-limited hosted call fail over to the
 * other hosted provider.
 * Cloud keys are read from the environment inside route handlers only — never
 * shipped to the client.
 */

/**
 * A system prompt, optionally as Anthropic content blocks so a block can
 * carry `cache_control` and be served from the provider's prompt cache.
 *
 * A plain string stays a plain string on the wire — nothing about the
 * existing callers changes. The block form is Anthropic-only; the Google
 * path flattens it back to text, because Gemini has no equivalent knob and
 * a cache marker there is simply not a thing to send.
 */
export type SystemPrompt = string | SystemTextBlock[];

export interface SystemTextBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

/** Gemini takes one string; a cached block's marker has no meaning there. */
function systemText(system: SystemPrompt): string {
  return typeof system === "string" ? system : system.map((block) => block.text).join("\n\n");
}

export interface CompleteOptions {
  model: string;
  system: SystemPrompt;
  user: string;
  maxTokens: number;
  temperature: number;
  /** Gemini only: allow the model to spend thinking tokens. Off keeps beats fast. */
  allowThinking?: boolean;
  /** Provider-reported usage, delivered after the response completes. */
  onUsage?: (usage: CompletionUsage) => void;
  /**
   * Ollama/Groq only: a JSON schema (typically derived from the caller's
   * existing zod schema via `toOllamaFormat`) passed as the request's
   * `format` (Ollama) or `response_format` (Groq), to help the model emit
   * valid JSON. This is assistance for the model, not a trust boundary —
   * callers must still `.safeParse` the result themselves.
   */
  jsonSchema?: Record<string, unknown>;
  /** Test-only seam: inject a fetch stub instead of hitting a real Ollama server. */
  fetchImpl?: typeof fetch;
}

export interface CompletionUsage {
  providerRequestId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  /** Ollama only, in milliseconds. Undefined for Anthropic/Google. */
  loadDurationMs?: number;
  promptEvalDurationMs?: number;
  evalDurationMs?: number;
  totalDurationMs?: number;
}

export type Provider = "google" | "anthropic" | "ollama" | "groq" | "nvidia";

export function providerFor(model: string): Provider {
  if (process.env.LLM_PROVIDER === "ollama") return "ollama";
  if (process.env.LLM_PROVIDER === "groq") return "groq";
  if (process.env.LLM_PROVIDER === "nvidia") return "nvidia";
  return model.toLowerCase().startsWith("gemini") ? "google" : "anthropic";
}

export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:4b";

export const GROQ_BASE_URL = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
export const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

export const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
export const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";

/** Thrown when the local Ollama server can't be reached. Never silently swallowed. */
export class LocalProviderUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`Ollama at ${OLLAMA_BASE_URL} is unavailable: ${String(cause)}`);
    this.name = "LocalProviderUnavailableError";
  }
}

/**
 * Thrown when a hosted free-tier provider (Groq/NVIDIA) is still rate-limited
 * or overloaded (429 or 503) after exhausting its own retry-with-backoff.
 * Distinct from a generic error so `complete`/`completeStream` can recognize
 * specifically this condition and choose to fail over to the other hosted
 * provider, without masking unrelated errors (bad request, auth) as if they
 * were rate limits.
 */
export class RemoteProviderRateLimitedError extends Error {
  readonly provider: "groq" | "nvidia";
  constructor(provider: "groq" | "nvidia", cause: unknown) {
    super(`${provider} is still rate-limited/overloaded after retrying: ${String(cause)}`);
    this.name = "RemoteProviderRateLimitedError";
    this.provider = provider;
  }
}

/** Converts a zod schema to the JSON-schema shape Ollama's `format` expects. */
export function toOllamaFormat(schema: z.ZodType): Record<string, unknown> {
  return zodToJsonSchema(schema, { target: "jsonSchema7", $refStrategy: "none" }) as Record<string, unknown>;
}

let remoteCallCount = 0;

/** Dev/eval instrumentation only: counts calls that left the machine. */
export function getRemoteCallCount(): number {
  return remoteCallCount;
}

export function resetRemoteCallCount(): void {
  remoteCallCount = 0;
}

export const BEAT_MODEL = process.env.BEAT_MODEL || "claude-haiku-4-5-20251001";
export const ARTIST_MODEL = process.env.ARTIST_MODEL || "claude-sonnet-4-6";
/** One fast structured decision per completed Story Mode utterance. */
export const STORY_MODEL = process.env.STORY_MODEL || BEAT_MODEL;
/** The live hand. Latency matters more than anything else here. */
export const SCRIBE_MODEL =
  process.env.SCRIBE_MODEL || "claude-haiku-4-5-20251001";
/**
 * Defaults to ARTIST_MODEL deliberately: reusing the same provider/model
 * means the existing provider_rate_cards row already covers it, so turning
 * on math mode needs no new billing configuration.
 */
export const MATH_MODEL = process.env.MATH_MODEL || ARTIST_MODEL;

export async function complete(opts: CompleteOptions): Promise<string> {
  const provider = providerFor(opts.model);
  if (provider === "ollama") {
    try {
      return await completeOllama(opts);
    } catch (err) {
      if (err instanceof LocalProviderUnavailableError && process.env.OLLAMA_ALLOW_FALLBACK === "1") {
        console.warn(`[llm] ${err.message} — falling back to Anthropic (OLLAMA_ALLOW_FALLBACK=1)`);
        remoteCallCount += 1;
        return completeAnthropic(opts);
      }
      throw err;
    }
  }
  remoteCallCount += 1;
  if (provider === "groq" || provider === "nvidia") {
    return completeHostedWithFallback(provider, opts);
  }
  return provider === "google" ? completeGoogle(opts) : completeAnthropic(opts);
}

/**
 * Groq and NVIDIA are both free-tier hosted providers with real rate limits
 * (Groq: tokens/minute; NVIDIA: requests/minute). GROQ_ALLOW_FALLBACK=1 /
 * NVIDIA_ALLOW_FALLBACK=1 let a still-rate-limited call fail over to the
 * other one instead of failing outright — same opt-in shape as
 * OLLAMA_ALLOW_FALLBACK, just between two hosted providers instead of
 * local-to-cloud.
 */
async function completeHostedWithFallback(provider: "groq" | "nvidia", opts: CompleteOptions): Promise<string> {
  const primary = provider === "groq" ? completeGroq : completeNvidia;
  try {
    return await primary(opts);
  } catch (err) {
    if (!(err instanceof RemoteProviderRateLimitedError)) throw err;
    const flag = provider === "groq" ? "GROQ_ALLOW_FALLBACK" : "NVIDIA_ALLOW_FALLBACK";
    if (process.env[flag] !== "1") throw err;
    const other = provider === "groq" ? "nvidia" : "groq";
    const hasOtherKey = Boolean(process.env[other === "groq" ? "GROQ_API_KEY" : "NVIDIA_API_KEY"]);
    const fallback = hasOtherKey ? other : "anthropic";
    console.warn(`[llm] ${err.message} — falling back to ${fallback} (${flag}=1)`);
    remoteCallCount += 1;
    if (fallback === "groq") return completeGroq(opts);
    if (fallback === "nvidia") return completeNvidia(opts);
    return completeAnthropic(opts);
  }
}

/**
 * Streaming variant. The Scribe renders one operation per line as it arrives,
 * so the marks appear in rhythm with speech instead of in a batch at the end.
 */
export async function* completeStream(
  opts: CompleteOptions,
): AsyncGenerator<string> {
  const provider = providerFor(opts.model);
  if (provider === "ollama") {
    try {
      yield* completeStreamOllama(opts);
      return;
    } catch (err) {
      if (err instanceof LocalProviderUnavailableError && process.env.OLLAMA_ALLOW_FALLBACK === "1") {
        console.warn(`[llm] ${err.message} — falling back to Anthropic (OLLAMA_ALLOW_FALLBACK=1)`);
        remoteCallCount += 1;
        yield* streamAnthropic(opts);
        return;
      }
      throw err;
    }
  }
  remoteCallCount += 1;
  if (provider === "google") {
    yield* streamGoogle(opts);
  } else if (provider === "groq" || provider === "nvidia") {
    yield* streamHostedWithFallback(provider, opts);
  } else {
    yield* streamAnthropic(opts);
  }
}

async function* streamHostedWithFallback(provider: "groq" | "nvidia", opts: CompleteOptions): AsyncGenerator<string> {
  const primary = provider === "groq" ? streamGroq : streamNvidia;
  try {
    yield* primary(opts);
    return;
  } catch (err) {
    if (!(err instanceof RemoteProviderRateLimitedError)) throw err;
    const flag = provider === "groq" ? "GROQ_ALLOW_FALLBACK" : "NVIDIA_ALLOW_FALLBACK";
    if (process.env[flag] !== "1") throw err;
    const other = provider === "groq" ? "nvidia" : "groq";
    const hasOtherKey = Boolean(process.env[other === "groq" ? "GROQ_API_KEY" : "NVIDIA_API_KEY"]);
    const fallback = hasOtherKey ? other : "anthropic";
    console.warn(`[llm] ${err.message} — falling back to ${fallback} (${flag}=1)`);
    remoteCallCount += 1;
    if (fallback === "groq") { yield* streamGroq(opts); return; }
    if (fallback === "nvidia") { yield* streamNvidia(opts); return; }
    yield* streamAnthropic(opts);
  }
}

async function* streamAnthropic(
  opts: CompleteOptions,
): AsyncGenerator<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const stream = await anthropic.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    stream: true,
  });

  let inputTokens = 0;
  let outputTokens = 0;
  let providerRequestId: string | undefined;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  for await (const event of stream) {
    if (event.type === "message_start") {
      providerRequestId = event.message.id;
      inputTokens = event.message.usage.input_tokens;
      cacheCreationInputTokens = event.message.usage.cache_creation_input_tokens ?? 0;
      cacheReadInputTokens = event.message.usage.cache_read_input_tokens ?? 0;
    }
    if (event.type === "message_delta") outputTokens = event.usage.output_tokens;
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
  opts.onUsage?.({ providerRequestId, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens });
}

async function* streamGoogle(opts: CompleteOptions): AsyncGenerator<string> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");

  const generationConfig: Record<string, unknown> = {
    temperature: opts.temperature,
    maxOutputTokens: opts.allowThinking
      ? opts.maxTokens + GOOGLE_THINKING_HEADROOM
      : opts.maxTokens,
  };
  if (!opts.allowThinking) {
    generationConfig.thinkingConfig = thinkingConfigFor(opts.model);
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      opts.model,
    )}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemText(opts.system) }] },
        contents: [{ role: "user", parts: [{ text: opts.user }] }],
        generationConfig,
      }),
    },
  );
  if (!res.ok || !res.body) {
    throw new Error(`Gemini stream ${res.status}: ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
        };
        inputTokens = Math.max(inputTokens, json.usageMetadata?.promptTokenCount ?? 0);
        outputTokens = Math.max(outputTokens, json.usageMetadata?.candidatesTokenCount ?? 0);
        for (const part of json.candidates?.[0]?.content?.parts ?? []) {
          if (part.text) yield part.text;
        }
      } catch {
        /* partial JSON across chunks; skip */
      }
    }
  }
  opts.onUsage?.({ inputTokens, outputTokens });
}

let anthropic: Anthropic | null = null;

async function completeAnthropic(opts: CompleteOptions): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });

  opts.onUsage?.({
    providerRequestId: response.id,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
  });

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/**
 * Gemini's "think less" knob differs by generation: 2.5 takes a token budget,
 * 3.x takes a level and rejects the budget outright with a 400.
 */
function thinkingConfigFor(model: string): Record<string, unknown> {
  return /^gemini-[3-9]/i.test(model)
    ? { thinkingLevel: "low" }
    : { thinkingBudget: 0 };
}

/** Thinking tokens count against maxOutputTokens, so leave the answer room. */
const GOOGLE_THINKING_HEADROOM = 2048;

async function completeGoogle(opts: CompleteOptions): Promise<string> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");

  const call = async (withThinkingConfig: boolean) => {
    const generationConfig: Record<string, unknown> = {
      temperature: opts.temperature,
      maxOutputTokens: opts.allowThinking
        ? opts.maxTokens + GOOGLE_THINKING_HEADROOM
        : opts.maxTokens,
    };
    if (!opts.allowThinking && withThinkingConfig) {
      generationConfig.thinkingConfig = thinkingConfigFor(opts.model);
    }

    return fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        opts.model,
      )}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemText(opts.system) }] },
          contents: [{ role: "user", parts: [{ text: opts.user }] }],
          generationConfig,
        }),
      },
    );
  };

  let res = await call(true);
  if (res.status === 400) {
    // A model that rejects our thinking knob is still worth answering with.
    const body = await res.text();
    console.warn(`[gemini] retrying without thinkingConfig: ${body}`);
    res = await call(false);
  }

  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    candidates?: {
      finishReason?: string;
      content?: { parts?: { text?: string }[] };
    }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  };

  opts.onUsage?.({
    inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
  });

  const candidate = json.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();

  if (!text) {
    // Most often MAX_TOKENS: thinking ate the whole budget. Say so, loudly —
    // silently returning "" reads downstream as "nothing to draw".
    console.warn(
      `[gemini] empty completion from ${opts.model} (finishReason=${
        candidate?.finishReason ?? "unknown"
      })`,
    );
  }

  return text;
}

/**
 * Groq reports the wait as a compound duration string like "1m2.9s" or
 * "615ms" in `x-ratelimit-reset-tokens`/`-requests`, not a plain seconds
 * count `retry-after` would give. Parses that format into milliseconds.
 */
function parseGroqDuration(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?(?:(\d+)ms)?$/);
  if (!match) return undefined;
  const [, h, m, s, ms] = match;
  const total = (Number(h) || 0) * 3_600_000 + (Number(m) || 0) * 60_000 + (Number(s) || 0) * 1000 + (Number(ms) || 0);
  return total > 0 ? total : undefined;
}

/**
 * Both Groq (tokens/minute) and NVIDIA (requests/minute, plus a shared-worker
 * 503 "local total request limit reached" on the free preview endpoint)
 * enforce real limits that a multi-call eval loop trips easily. Retries on
 * 429/503, preferring the exact reset time a provider reports over guessing
 * with plain exponential backoff. Returns the still-failing response after
 * exhausting retries rather than throwing — callers decide how to surface it.
 */
async function fetchWithRateLimitRetry(url: string, init: RequestInit, maxRetries = 8): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, init);
    const retryable = res.status === 429 || res.status === 503;
    if (!retryable || attempt >= maxRetries) return res;
    // Per https://console.groq.com/docs/rate-limits, `retry-after` (plain
    // seconds) is the authoritative wait once a 429 has actually happened;
    // Groq's reset-* headers are for proactive monitoring and are a
    // fallback. NVIDIA's NIM API sends neither reset-* headers nor a
    // reliable retry-after, so it falls through to plain backoff.
    const retryAfterSeconds = Number(res.headers.get("retry-after"));
    const reported = (retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : undefined)
      ?? parseGroqDuration(res.headers.get("x-ratelimit-reset-tokens"))
      ?? parseGroqDuration(res.headers.get("x-ratelimit-reset-requests"));
    const waitMs = Math.min((reported ?? 2 ** attempt * 1000) + 250, 65_000);
    await res.text(); // drain the body before retrying
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

function groqMessages(opts: CompleteOptions): { role: string; content: string }[] {
  return [
    { role: "system", content: systemText(opts.system) },
    { role: "user", content: opts.user },
  ];
}

/**
 * Even at reasoning_effort "low", Groq's reasoning models (gpt-oss, qwen3.x)
 * still spend some of max_tokens on a reasoning pass before real content —
 * observed enough on real communicator prompts to occasionally exhaust a
 * caller's max_tokens budget entirely, which Groq's JSON-mode validation
 * then reports as a 400 "Failed to validate JSON" (empty failed_generation)
 * rather than a truncated response. Mirrors GOOGLE_THINKING_HEADROOM below.
 */
const HOSTED_REASONING_HEADROOM = 1500;

/**
 * Groq's chat completions API is OpenAI-compatible. Its strict `json_schema`
 * mode requires the root schema to be a plain object — it rejects a top-level
 * `oneOf`/`anyOf`, which is exactly what zod discriminated unions (used by
 * most schemas passed here, e.g. CommunicationDecisionSchema) compile to.
 * `json_object` mode has no such restriction; the caller's system prompt
 * already spells out the exact shape in prose, and `.safeParse` remains the
 * real trust boundary regardless — same as the Ollama `format` field.
 */
function groqResponseFormat(jsonSchema: Record<string, unknown> | undefined) {
  if (!jsonSchema) return undefined;
  return { type: "json_object" };
}

interface GroqChatResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  x_groq?: { id?: string };
}

function groqUsageFrom(json: {
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  x_groq?: { id?: string };
}): CompletionUsage {
  return {
    providerRequestId: json.x_groq?.id,
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
  };
}

async function completeGroq(opts: CompleteOptions): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");

  const res = await fetchWithRateLimitRetry(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: groqMessages(opts),
      temperature: opts.temperature,
      max_tokens: opts.maxTokens + HOSTED_REASONING_HEADROOM,
      response_format: groqResponseFormat(opts.jsonSchema),
      // Reasoning models on Groq (gpt-oss, qwen3.x) spend part of maxTokens
      // on a "reasoning" pass before real content, same issue as Ollama's
      // qwen3 think block — reusing the existing allowThinking flag keeps
      // that uniform across providers instead of adding a second knob.
      reasoning_effort: opts.allowThinking ? undefined : "low",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429 || res.status === 503) throw new RemoteProviderRateLimitedError("groq", body);
    throw new Error(`Groq ${res.status}: ${body}`);
  }
  const json = (await res.json()) as GroqChatResponse;
  opts.onUsage?.(groqUsageFrom(json));
  return (json.choices?.[0]?.message?.content ?? "").trim();
}

async function* streamGroq(opts: CompleteOptions): AsyncGenerator<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");

  const res = await fetchWithRateLimitRetry(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: groqMessages(opts),
      temperature: opts.temperature,
      max_tokens: opts.maxTokens + HOSTED_REASONING_HEADROOM,
      response_format: groqResponseFormat(opts.jsonSchema),
      reasoning_effort: opts.allowThinking ? undefined : "low",
      stream: true,
      stream_options: { include_usage: true },
    }),
  });
  if (res.status === 429 || res.status === 503) throw new RemoteProviderRateLimitedError("groq", await res.text());
  if (!res.ok || !res.body) {
    throw new Error(`Groq stream ${res.status}: ${res.body ? await res.text() : "no body"}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let json: {
        choices?: { delta?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        x_groq?: { id?: string };
      };
      try {
        json = JSON.parse(payload);
      } catch {
        continue; // partial JSON across chunks
      }
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) yield delta;
      if (json.usage) opts.onUsage?.(groqUsageFrom(json));
    }
  }
}

/** NVIDIA's NIM API is also OpenAI-compatible chat completions. */
function nvidiaMessages(opts: CompleteOptions): { role: string; content: string }[] {
  return [
    { role: "system", content: systemText(opts.system) },
    { role: "user", content: opts.user },
  ];
}

/** Same top-level oneOf/anyOf restriction as Groq's strict mode — see groqResponseFormat. */
function nvidiaResponseFormat(jsonSchema: Record<string, unknown> | undefined) {
  if (!jsonSchema) return undefined;
  return { type: "json_object" };
}

interface NvidiaChatResponse {
  id?: string;
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function nvidiaUsageFrom(json: {
  id?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}): CompletionUsage {
  return {
    providerRequestId: json.id,
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
  };
}

async function completeNvidia(opts: CompleteOptions): Promise<string> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY is not set");

  const res = await fetchWithRateLimitRetry(`${NVIDIA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages: nvidiaMessages(opts),
      temperature: opts.temperature,
      max_tokens: opts.maxTokens + HOSTED_REASONING_HEADROOM,
      response_format: nvidiaResponseFormat(opts.jsonSchema),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429 || res.status === 503) throw new RemoteProviderRateLimitedError("nvidia", body);
    throw new Error(`NVIDIA ${res.status}: ${body}`);
  }
  const json = (await res.json()) as NvidiaChatResponse;
  opts.onUsage?.(nvidiaUsageFrom(json));
  return (json.choices?.[0]?.message?.content ?? "").trim();
}

async function* streamNvidia(opts: CompleteOptions): AsyncGenerator<string> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY is not set");

  const res = await fetchWithRateLimitRetry(`${NVIDIA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages: nvidiaMessages(opts),
      temperature: opts.temperature,
      max_tokens: opts.maxTokens + HOSTED_REASONING_HEADROOM,
      response_format: nvidiaResponseFormat(opts.jsonSchema),
      stream: true,
      stream_options: { include_usage: true },
    }),
  });
  if (res.status === 429 || res.status === 503) throw new RemoteProviderRateLimitedError("nvidia", await res.text());
  if (!res.ok || !res.body) {
    throw new Error(`NVIDIA stream ${res.status}: ${res.body ? await res.text() : "no body"}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let json: {
        id?: string;
        choices?: { delta?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      try {
        json = JSON.parse(payload);
      } catch {
        continue; // partial JSON across chunks
      }
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) yield delta;
      if (json.usage) opts.onUsage?.(nvidiaUsageFrom(json));
    }
  }
}

interface OllamaChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  load_duration?: number;
  prompt_eval_duration?: number;
  eval_duration?: number;
  total_duration?: number;
}

function ollamaMessages(opts: CompleteOptions): { role: string; content: string }[] {
  return [
    { role: "system", content: systemText(opts.system) },
    { role: "user", content: opts.user },
  ];
}

function ollamaUsageFrom(json: OllamaChatResponse): CompletionUsage {
  const ns = (v: number | undefined) => (v === undefined ? undefined : Math.round(v / 1_000_000));
  return {
    inputTokens: json.prompt_eval_count ?? 0,
    outputTokens: json.eval_count ?? 0,
    loadDurationMs: ns(json.load_duration),
    promptEvalDurationMs: ns(json.prompt_eval_duration),
    evalDurationMs: ns(json.eval_duration),
    totalDurationMs: ns(json.total_duration),
  };
}

async function ollamaFetch(opts: CompleteOptions, stream: boolean): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    return await doFetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: ollamaMessages(opts),
        stream,
        options: { temperature: opts.temperature },
        // Reasoning models (qwen3 included) default to a verbose "thinking"
        // pass in Ollama that can consume the entire maxTokens budget before
        // any real content, leaving `message.content` empty. Every existing
        // caller already passes allowThinking: false or omits it (it exists
        // today only for Gemini's thinking budget) — reusing the same flag
        // here keeps the "keep local calls short and task-specific" rule
        // enforced uniformly across providers instead of adding a second knob.
        think: Boolean(opts.allowThinking),
        ...(opts.jsonSchema ? { format: opts.jsonSchema } : {}),
      }),
    });
  } catch (err) {
    throw new LocalProviderUnavailableError(err);
  }
}

/**
 * qwen3's chat template inlines its reasoning as a literal `<think>...</think>`
 * block at the start of `message.content` on at least one observed
 * Ollama/model combination, even with `think: false` sent — Ollama's separate
 * `message.thinking` field is not populated in that case, so there is
 * nothing to prefer over content; the tag has to be stripped from content
 * itself. Stripping unconditionally is safe: a response with no such block is
 * returned unchanged.
 */
function stripThinkBlock(content: string): string {
  return content.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, "");
}

async function completeOllama(opts: CompleteOptions): Promise<string> {
  const res = await ollamaFetch(opts, false);
  if (!res.ok) {
    if (res.status >= 500 || res.status === 404) {
      throw new LocalProviderUnavailableError(`HTTP ${res.status}: ${await res.text()}`);
    }
    throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as OllamaChatResponse;
  opts.onUsage?.(ollamaUsageFrom(json));
  return stripThinkBlock(json.message?.content ?? "").trim();
}

/**
 * No `<think>` stripping here, unlike completeOllama: none of the four
 * current Ollama call sites (agent/communicator decision, shaping,
 * extraction) use the streaming path — only the Anthropic-only Scribe route
 * does today — and stripping a tag that can straddle chunk boundaries would
 * need real buffering. Add it if a streaming Ollama caller appears.
 */
async function* completeStreamOllama(opts: CompleteOptions): AsyncGenerator<string> {
  const res = await ollamaFetch(opts, true);
  if (!res.ok || !res.body) {
    if (!res.ok && (res.status >= 500 || res.status === 404)) {
      throw new LocalProviderUnavailableError(`HTTP ${res.status}: ${await res.text()}`);
    }
    throw new Error(`Ollama stream ${res.status}: ${res.body ? await res.text() : "no body"}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let json: OllamaChatResponse & { done?: boolean };
      try {
        json = JSON.parse(line);
      } catch {
        continue; // partial JSON across chunks
      }
      if (json.message?.content) yield json.message.content;
      if (json.done) opts.onUsage?.(ollamaUsageFrom(json));
    }
  }
}
