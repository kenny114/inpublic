/**
 * Word error rate with a full alignment, so errors can be attributed to a
 * KIND (substitution / deletion / insertion) and to a specific word pair —
 * "what does InPublic get wrong", not just "how wrong is it".
 */

/** Lowercase, strip punctuation, collapse space. Numbers are normalised
 * separately because smart_format writes "39" where the reference says
 * "thirty nine", and scoring that as an error would measure formatting rather
 * than recognition. */
export function normalize(text, { numbers = true } = {}) {
  let s = String(text ?? "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'%$.\s-]/g, " ");
  if (numbers) s = spellNumbers(s);
  return s
    .replace(/[.'%$-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
  "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function spellInt(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
  if (n < 1000) {
    return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${spellInt(n % 100)}` : ""}`;
  }
  if (n < 1000000) {
    return `${spellInt(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${spellInt(n % 1000)}` : ""}`;
  }
  return String(n);
}

/** "39" -> "thirty nine", "42%" -> "forty two percent", "$30" -> "thirty dollars". */
export function spellNumbers(s) {
  return s
    .replace(/\$\s?(\d+)/g, (_, d) => `${spellInt(Number(d))} dollars`)
    .replace(/(\d+)\s?%/g, (_, d) => `${spellInt(Number(d))} percent`)
    .replace(/\b(\d+)\b/g, (m, d) => (Number(d) < 1000000 ? spellInt(Number(d)) : m))
    // written forms the reference and the recogniser disagree on cosmetically
    .replace(/\bone hundred twenty\b/g, "one hundred and twenty")
    .replace(/\btimes\b/g, "times")
    .replace(/\bx\b/g, "x");
}

/**
 * Levenshtein alignment over word arrays.
 * @returns {{wer:number, sub:number, del:number, ins:number, hit:number, ops:Array}}
 */
export function align(refWords, hypWords) {
  const R = refWords.length;
  const H = hypWords.length;
  const d = Array.from({ length: R + 1 }, () => new Int32Array(H + 1));
  const bt = Array.from({ length: R + 1 }, () => new Uint8Array(H + 1)); // 0 ok 1 sub 2 del 3 ins
  for (let i = 0; i <= R; i += 1) { d[i][0] = i; bt[i][0] = 2; }
  for (let j = 0; j <= H; j += 1) { d[0][j] = j; bt[0][j] = 3; }
  bt[0][0] = 0;
  for (let i = 1; i <= R; i += 1) {
    for (let j = 1; j <= H; j += 1) {
      const same = refWords[i - 1] === hypWords[j - 1];
      const subCost = d[i - 1][j - 1] + (same ? 0 : 1);
      const delCost = d[i - 1][j] + 1;
      const insCost = d[i][j - 1] + 1;
      const best = Math.min(subCost, delCost, insCost);
      d[i][j] = best;
      bt[i][j] = best === subCost ? (same ? 0 : 1) : best === delCost ? 2 : 3;
    }
  }
  const ops = [];
  let i = R;
  let j = H;
  let sub = 0;
  let del = 0;
  let ins = 0;
  let hit = 0;
  while (i > 0 || j > 0) {
    const op = bt[i][j];
    if (op === 0) { ops.push({ op: "ok", ref: refWords[i - 1], hyp: hypWords[j - 1] }); hit += 1; i -= 1; j -= 1; }
    else if (op === 1) { ops.push({ op: "sub", ref: refWords[i - 1], hyp: hypWords[j - 1] }); sub += 1; i -= 1; j -= 1; }
    else if (op === 2) { ops.push({ op: "del", ref: refWords[i - 1], hyp: null }); del += 1; i -= 1; }
    else { ops.push({ op: "ins", ref: null, hyp: hypWords[j - 1] }); ins += 1; j -= 1; }
  }
  ops.reverse();
  return { wer: R ? (sub + del + ins) / R : 0, sub, del, ins, hit, refLen: R, ops };
}

export function score(referenceText, hypothesisText) {
  return align(normalize(referenceText).split(" ").filter(Boolean),
               normalize(hypothesisText).split(" ").filter(Boolean));
}

/** Did each expected keyterm survive into the hypothesis, case-insensitively? */
export function keytermRecall(terms, hypothesisText) {
  const hay = ` ${String(hypothesisText).toLowerCase()} `;
  return (terms ?? []).map((t) => ({ term: t, found: hay.includes(` ${t.toLowerCase()} `) || hay.includes(`${t.toLowerCase()}`) }));
}

export function mean(values) {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}
