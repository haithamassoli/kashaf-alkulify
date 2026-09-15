/** The search service's base URL; `astro dev` talks to a local `npm run search:serve`. */
export const SEARCH_ENDPOINT = (
  import.meta.env.PUBLIC_SEARCH_API_URL ??
  (import.meta.env.DEV ? "http://127.0.0.1:8787" : "")
).replace(/\/$/, "");
