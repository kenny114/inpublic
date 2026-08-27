/**
 * Shared number formatting for the metric primitives (metric_value,
 * metric_series, metric_gauge) — factored out so the SVG and Excalidraw
 * renderers cannot quietly drift on how "$1,234" or "~42%" gets written,
 * which is exactly the kind of divergence lib/expression/render/svg.ts
 * exists to catch (see that file's own header comment).
 */

import type { MetricPoint, WorldMetric } from "../schemas";

/** "1,234" / "1,234.5" — comma-grouped, at most one decimal, no locale dependence (this runs in tests). */
export function formatMetricNumber(value: number): string {
  const rounded = Math.abs(value - Math.round(value)) < 0.05 ? Math.round(value) : Math.round(value * 10) / 10;
  const [intPart, decPart] = String(rounded).split(".");
  const negative = intPart.startsWith("-");
  const digits = negative ? intPart.slice(1) : intPart;
  const withCommas = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${withCommas}${decPart ? `.${decPart}` : ""}`;
}

/** "$1,234" / "42%" / "1,234" — unit-aware, "~" prefix preserved for a stated approximation rather than rounded away. */
export function formatMetricPoint(point: MetricPoint, metric: Pick<WorldMetric, "unit" | "currency">): string {
  const num = formatMetricNumber(point.value);
  let out: string;
  if (metric.unit === "percent") out = `${num}%`;
  else if (metric.unit === "currency") {
    const currency = metric.currency;
    out = !currency || currency === "USD" || currency === "$" ? `$${num}` : `${currency} ${num}`;
  } else out = num;
  return point.approximate ? `~${out}` : out;
}
