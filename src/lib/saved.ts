import { articlePath, lessonPath } from "./paths";

const KEY = "kashaf:saved";

export type SavedKind = "a" | "v";

export interface SavedItem {
  at: number;
  kind: SavedKind;
  title: string;
}

/** Items saved before detail pages had their own paths (`/a/?id=…`). */
const LEGACY = /^\/([av])\/\?id=([^&]+)/;

const currentHref = (href: string): string => {
  const [, kind, id] = LEGACY.exec(href) ?? [];

  if (!(kind && id)) {
    return href;
  }
  const path = decodeURIComponent(id);

  return kind === "a" ? articlePath(path) : lessonPath(path);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isSavedItem = (value: unknown): value is SavedItem =>
  isRecord(value) &&
  typeof value.at === "number" &&
  (value.kind === "a" || value.kind === "v") &&
  typeof value.title === "string";

export const savedItems = (): Record<string, SavedItem> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");

    if (!isRecord(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .filter(
          (entry): entry is [string, SavedItem] =>
            entry[0].startsWith("/") && isSavedItem(entry[1])
        )
        .map(([href, item]) => [currentHref(href), item])
    );
  } catch {
    return {};
  }
};

export const setSaved = (href: string, item?: Omit<SavedItem, "at">): void => {
  const items = savedItems();

  if (item) {
    items[href] = { ...item, at: Date.now() };
  } else {
    delete items[href];
  }

  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Saving is optional; private browsing must not break the page.
  }
};
