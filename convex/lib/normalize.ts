/**
 * The `normVersion` v1 contract, ported from the pipeline's `normalize.py`.
 *
 * Two writers now produce `normalizedTitle` — the Organizer and the dashboard's
 * rename — and they index into the same search index, so they have to fold text
 * the same way. A rename that normalized differently would be unfindable by the
 * search that already indexed every pipeline-written title.
 */

const DIGITS: [string, string][] = Array.from(
  { length: 10 },
  (_, n) => n
).flatMap((n) => [
  [String.fromCharCode(0x06_60 + n), String(n)],
  [String.fromCharCode(0x06_f0 + n), String(n)],
]);

/** أ/إ/آ/ٱ → ا, ة → ه, ى → ي, tatweel dropped, Arabic-Indic digits → Latin. */
const FOLD = new Map<string, string>([
  ["أ", "ا"],
  ["إ", "ا"],
  ["آ", "ا"],
  ["ٱ", "ا"],
  ["ة", "ه"],
  ["ى", "ي"],
  ["ـ", ""],
  ...DIGITS,
]);

const WHITESPACE = /\s+/u;

export const NORM_VERSION = "norm-v1";

/**
 * `normalize.py` drops characters with a non-zero combining class; this drops
 * the Unicode Mark category. The two differ only on marks that are Mn with
 * class 0 — Quranic annotation signs, which do not occur in a lesson title and
 * certainly not in one an admin types by hand.
 */
export const normalize = (text: string): string =>
  [...text.normalize("NFKC").replace(/\p{M}/gu, "")]
    .map((character) => FOLD.get(character) ?? character)
    .join("")
    .split(WHITESPACE)
    .filter((word) => word.length > 0)
    .join(" ");
