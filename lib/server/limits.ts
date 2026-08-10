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

export const routeLimits: Record<string, { limit: number; windowSeconds: number }> = {
  deepgram: { limit: positiveInteger("RATE_LIMIT_DEEPGRAM_TOKENS", 3), windowSeconds: 600 },
  gemini: { limit: positiveInteger("RATE_LIMIT_GEMINI_TOKENS", 3), windowSeconds: 600 },
  scribe: { limit: positiveInteger("RATE_LIMIT_SCRIBE_PER_MINUTE", 12), windowSeconds: 60 },
  beat: { limit: positiveInteger("RATE_LIMIT_BEAT_PER_MINUTE", 10), windowSeconds: 60 },
  artist: { limit: positiveInteger("RATE_LIMIT_ARTIST_PER_MINUTE", 6), windowSeconds: 60 },
  story: { limit: positiveInteger("RATE_LIMIT_STORY_PER_MINUTE", 8), windowSeconds: 60 },
  math: { limit: positiveInteger("RATE_LIMIT_MATH_PER_MINUTE", 6), windowSeconds: 60 },
  audio: { limit: positiveInteger("RATE_LIMIT_AUDIO_PER_MINUTE", 4), windowSeconds: 60 },
};
