import {
  convexClient,
  crossDomainClient,
} from "@convex-dev/better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// The Better Auth handler lives on the Convex *site* URL (.site), not the API
// URL (.cloud). Read it once so a missing variable fails loudly instead of
// silently pointing the client at the current origin.
const baseURL: string | undefined = import.meta.env.PUBLIC_CONVEX_SITE_URL;

if (!baseURL) {
  throw new Error(
    "PUBLIC_CONVEX_SITE_URL is not set. Point it at the Convex .site URL."
  );
}

export const authClient = createAuthClient({
  baseURL,
  plugins: [convexClient(), crossDomainClient()],
});
