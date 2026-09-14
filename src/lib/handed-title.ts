/** The title the clicked link handed over at `pageswap` (Base.astro), if it was for this URL. */
export const handedTitle = (): string | undefined => {
  try {
    const seed: unknown = JSON.parse(
      sessionStorage.getItem("vt-title") ?? "null"
    );
    if (
      seed &&
      typeof seed === "object" &&
      "title" in seed &&
      "url" in seed &&
      typeof seed.title === "string" &&
      seed.url === window.location.href
    ) {
      return seed.title;
    }
  } catch {
    // Storage is off; the title arrives with the data instead.
  }
  return undefined;
};
