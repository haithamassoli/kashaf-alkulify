import type { ReactNode } from "react";

const ARABIC_MARKS = /[\u0610-\u061a\u0640\u064b-\u065f\u0670\u06d6-\u06ed]/gu;
const TOKEN = /[\p{L}\p{M}\p{N}]+/gu;

export const normalizeArabic = (text: string): string =>
  text
    .normalize("NFKC")
    .replace(ARABIC_MARKS, "")
    .replaceAll(/[أإآٱ]/gu, "ا")
    .replaceAll("ة", "ه")
    .replaceAll("ى", "ي")
    .replaceAll("ؤ", "و")
    .replaceAll("ئ", "ي")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Highlight query words without injecting HTML from either the query or transcript. */
export const highlightWords = (text: string, query: string): ReactNode[] => {
  const terms = new Set(
    (query.match(TOKEN) ?? []).map(normalizeArabic).filter(Boolean)
  );

  if (terms.size === 0) {
    return [text];
  }

  const output: ReactNode[] = [];
  let offset = 0;

  for (const match of text.matchAll(TOKEN)) {
    const start = match.index;
    const [word] = match;
    const folded = normalizeArabic(word);
    const marked = [...terms].some(
      (term) => folded === term || (term.length > 2 && folded.includes(term))
    );

    if (start > offset) {
      output.push(text.slice(offset, start));
    }
    output.push(marked ? <mark key={start}>{word}</mark> : word);
    offset = start + word.length;
  }

  if (offset < text.length) {
    output.push(text.slice(offset));
  }

  return output;
};
