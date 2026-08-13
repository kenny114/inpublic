"use client";

/**
 * Captures the marketing-attribution context once, on first landing, and
 * makes it available to every analytics call for the rest of the funnel
 * (try_page_view through signup_completed_from_trial) without re-reading
 * location.search once the visitor has navigated on to /login and back.
 * sessionStorage rather than a cookie: this is purely for our own event
 * properties, never sent to or read by the server.
 */
const STORAGE_KEY = "inpublic_attribution";

export interface Attribution {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrer: string | null;
  referrerHost: string | null;
  landingRoute: string;
  device: "mobile" | "tablet" | "desktop";
}

function detectDevice(): Attribution["device"] {
  if (typeof window === "undefined") return "desktop";
  const width = window.innerWidth;
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

function hostOf(url: string): string | null {
  try { return new URL(url).host; } catch { return null; }
}

/** Idempotent: only the first call on a given tab actually captures anything. */
export function captureAttribution(landingRoute: string): Attribution {
  if (typeof window === "undefined") {
    return { utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null, referrer: null, referrerHost: null, landingRoute, device: "desktop" };
  }
  const existing = sessionStorage.getItem(STORAGE_KEY);
  if (existing) {
    try { return JSON.parse(existing) as Attribution; } catch { /* fall through and recapture */ }
  }
  const params = new URLSearchParams(window.location.search);
  const value: Attribution = {
    utmSource: params.get("utm_source"),
    utmMedium: params.get("utm_medium"),
    utmCampaign: params.get("utm_campaign"),
    utmContent: params.get("utm_content"),
    utmTerm: params.get("utm_term"),
    referrer: document.referrer || null,
    referrerHost: document.referrer ? hostOf(document.referrer) : null,
    landingRoute,
    device: detectDevice(),
  };
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* private mode / quota — attribution just won't persist across pages */ }
  return value;
}

export function getAttribution(): Attribution | null {
  if (typeof window === "undefined") return null;
  const existing = sessionStorage.getItem(STORAGE_KEY);
  if (!existing) return null;
  try { return JSON.parse(existing) as Attribution; } catch { return null; }
}

/** Flattened to string/number/boolean/null, which is all @vercel/analytics' track() accepts as property values. */
export function attributionProperties(attribution: Attribution | null): Record<string, string | number | boolean | null> {
  if (!attribution) return {};
  return {
    utm_source: attribution.utmSource,
    utm_medium: attribution.utmMedium,
    utm_campaign: attribution.utmCampaign,
    referrer_host: attribution.referrerHost,
    landing_route: attribution.landingRoute,
    device: attribution.device,
  };
}
