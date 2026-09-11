import betterAuth from "@convex-dev/better-auth/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    /** Comma-separated list of emails allowed to use the admin API. */
    ADMIN_EMAILS: v.string(),
    /** Origin of the Astro site, used for CORS and auth redirects. */
    SITE_URL: v.string(),
  },
});

app.use(betterAuth);

export default app;
