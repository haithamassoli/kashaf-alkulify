import { ConvexReactClient } from "convex/react";

// Typed by hand: Astro widens unknown `import.meta.env` keys, and Biome forbids
// the `!` that would otherwise paper over a missing deployment URL.
const url: string | undefined = import.meta.env.PUBLIC_CONVEX_URL;

if (!url) {
  throw new Error(
    "PUBLIC_CONVEX_URL is not set — add the Convex deployment's .cloud URL to .env.local."
  );
}

/**
 * The browser's Convex client. Anonymous on purpose: every query it runs is
 * public, so it must not wait for an auth token before subscribing.
 */
export const convex = new ConvexReactClient(url);
