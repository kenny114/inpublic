/**
 * Display compression for meaning visuals. The semantic label can be a
 * clause; the box cannot. Cutting words here is a drawing decision, not a
 * meaning decision — SemanticState keeps the full label.
 */

const MAX_WORDS = 4;
const MAX_CHARS = 26;

export function displayConceptLabel(label: string, quantity?: { value: number; unit?: string }): string {
  const words = label
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length && !quantity) return "";
  let out = words.slice(0, MAX_WORDS).join(" ");
  if (quantity && Number.isFinite(quantity.value)) {
    const qty = Number.isInteger(quantity.value) ? String(quantity.value) : String(quantity.value);
    const unit = quantity.unit ? ` ${quantity.unit}` : "";
    if (!out.toLowerCase().includes(qty.toLowerCase())) out = `${qty}${unit} ${out}`.trim();
  }
  if (out.length > MAX_CHARS) out = `${out.slice(0, MAX_CHARS - 1).trimEnd()}…`;
  return out;
}
