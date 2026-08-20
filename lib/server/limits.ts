import "server-only";

function positiveNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function positiveInteger(name: string, fallback: number) {
  return Math.floor(positiveNumber(name, fallback));
}

export const spendLimits = {
  userDailyUsd: positiveNumber("COST_MAX_USER_DAILY_USD", 0.75),
  userPeriodUsd: positiveNumber("COST_MAX_USER_PERIOD_USD", 8),
  globalHourlyUsd: positiveNumber("COST_MAX_GLOBAL_HOURLY_USD", 5),
  globalDailyUsd: positiveNumber("COST_MAX_GLOBAL_DAILY_USD", 25),
  globalMonthlyUsd: positiveNumber("COST_MAX_GLOBAL_MONTHLY_USD", 250),
  artistSessionUsd: positiveNumber("COST_MAX_ARTIST_SESSION_USD", 0.5),
  providerCallsPerSession: positiveInteger("COST_MAX_PROVIDER_CALLS_PER_SESSION", 500),
  globalConcurrentSessions: positiveInteger("USAGE_MAX_GLOBAL_CONCURRENT_SESSIONS", 100),
};

export const usageLeaseSeconds = Math.min(
  45,
  positiveInteger("USAGE_LEASE_SECONDS", 30),
);

export const backgroundPauseSeconds = positiveInteger(
  "NEXT_PUBLIC_BACKGROUND_PAUSE_SECONDS",
  30,
);

/** Anonymous /try trial allowance, once per anon_id, ever (no monthly recurrence). */
export const anonymousTrialSeconds = positiveInteger("ANON_TRIAL_SECONDS", 300);
/** Distinct anon_ids allowed from the same hashed IP in a rolling 24h window. */
export const anonymousIpDailyLimit = positiveInteger("ANON_TRIAL_IP_DAILY_LIMIT", 3);

export const routeLimits: Record<string, { limit: number; windowSeconds: number }> = {
  // 3 per 10 minutes was incompatible with the reconnect ladder, which can
  // try up to 12 times and used to mint a credential per attempt — a session
  // that dropped four times could not come back. The client now reuses an
  // unexpired credential (hooks/useDeepgram.ts tokenRef), so mints are rare;
  // this ceiling covers legitimate stop/start cycles and genuine token
  // invalidation without being the thing that ends a session.
  deepgram: { limit: positiveInteger("RATE_LIMIT_DEEPGRAM_TOKENS", 10), windowSeconds: 600 },
  gemini: { limit: positiveInteger("RATE_LIMIT_GEMINI_TOKENS", 3), windowSeconds: 600 },
  // Raised from 12 alongside the client cooldown drop (5250ms → 1200ms). The
  // client's scheduler refuses wake-ups with no new content, so observed rates
  // stay well below this; the ceiling exists to bound a misbehaving client,
  // not to pace a healthy one.
  scribe: { limit: positiveInteger("RATE_LIMIT_SCRIBE_PER_MINUTE", 30), windowSeconds: 60 },
  beat: { limit: positiveInteger("RATE_LIMIT_BEAT_PER_MINUTE", 10), windowSeconds: 60 },
  artist: { limit: positiveInteger("RATE_LIMIT_ARTIST_PER_MINUTE", 6), windowSeconds: 60 },
  story: { limit: positiveInteger("RATE_LIMIT_STORY_PER_MINUTE", 8), windowSeconds: 60 },
  math: { limit: positiveInteger("RATE_LIMIT_MATH_PER_MINUTE", 6), windowSeconds: 60 },
  audio: { limit: positiveInteger("RATE_LIMIT_AUDIO_PER_MINUTE", 4), windowSeconds: 60 },
  // At most one call per settled thought, and thoughts are naturally paced by
  // speech — this only bounds a misbehaving client, same reasoning as beat's.
  "visual-reentry": { limit: positiveInteger("RATE_LIMIT_VISUAL_REENTRY_PER_MINUTE", 20), windowSeconds: 60 },
  // The engine debounces/coalesces settled thoughts before calling (see
  // lib/meaning/engine.ts), so observed rates stay well under one call per
  // settled thought — this only bounds a misbehaving client.
  // One call per input segment, and segments are sentences — a person typing
  // a paragraph into the expression lab produces a short burst, so the
  // ceiling is a little higher than the meaning engine's debounced rate.
  "expression-engine": { limit: positiveInteger("RATE_LIMIT_EXPRESSION_ENGINE_PER_MINUTE", 30), windowSeconds: 60 },
  // One call per NEW concept, not per mention — the sketch library serves
  // every repeat for free, so this only bounds a burst of genuinely novel
  // concepts, which is rarer than a burst of sentences.
  "sketch-agent": { limit: positiveInteger("RATE_LIMIT_SKETCH_AGENT_PER_MINUTE", 20), windowSeconds: 60 },
};
