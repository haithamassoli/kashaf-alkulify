/**
 * A series name is one path segment, so the characters a path reserves are
 * swapped out. NFC first: the archive holds names that differ only in how
 * a letter is encoded, and those must share one page.
 */
const RESERVED = /[/?#%\\]/g;

export const seriesSlug = (name: string): string =>
  name.normalize("NFC").replaceAll(RESERVED, "-");

export const articlePath = (id: string): string =>
  `/a/${encodeURIComponent(id)}/`;

export const lessonPath = (id: string): string =>
  `/v/${encodeURIComponent(id)}/`;

export const seriesPath = (name: string): string =>
  `/p/${encodeURIComponent(seriesSlug(name))}/`;
