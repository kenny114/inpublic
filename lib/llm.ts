import Anthropic from "@anthropic-ai/sdk";

/**
 * Thin two-provider shim. Model id decides the provider: anything starting
 * with "gemini" goes to Google, everything else to Anthropic. Both keys are
 * read from the environment inside route handlers only — never shipped to the
 * client.
 */

export interface CompleteOptions {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  /** Gemini only: allow the model to spend thinking tokens. Off keeps beats fast. */
  allowThinking?: boolean;
}

export function providerFor(model: string): "google" | "anthropic" {
  return model.toLowerCase().startsWith("gemini") ? "google" : "anthropic";
}

export const BEAT_MODEL = process.env.BEAT_MODEL || "claude-haiku-4-5-20251001";
export const ARTIST_MODEL = process.env.ARTIST_MODEL || "claude-sonnet-4-6";
/** One fast structured decision per completed Story Mode utterance. */
export const STORY_MODEL = process.env.STORY_MODEL || BEAT_MODEL;
/** The live hand. Latency matters more than anything else here. */
export const SCRIBE_MODEL =
  process.env.SCRIBE_MODEL || "claude-haiku-4-5-20251001";

export async function complete(opts: CompleteOptions): Promise<string> {
  return providerFor(opts.model) === "google"
    ? completeGoogle(opts)
    : completeAnthropic(opts);
}

/**
 * Streaming variant. The Scribe renders one operation per line as it arrives,
 * so the marks appear in rhythm with speech instead of in a batch at the end.
 */
export async function* completeStream(
  opts: CompleteOptions,
): AsyncGenerator<string> {
  if (providerFor(opts.model) === "google") {
    yield* streamGoogle(opts);
  } else {
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

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
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
        systemInstruction: { parts: [{ text: opts.system }] },
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
        };
        for (const part of json.candidates?.[0]?.content?.parts ?? []) {
          if (part.text) yield part.text;
        }
      } catch {
        /* partial JSON across chunks; skip */
      }
    }
  }
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
          systemInstruction: { parts: [{ text: opts.system }] },
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
  };

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
