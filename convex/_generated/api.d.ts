/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as books from "../books.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_lessons from "../lib/lessons.js";
import type * as lib_normalize from "../lib/normalize.js";
import type * as media from "../media.js";
import type * as mutations from "../mutations.js";
import type * as queries from "../queries.js";
import type * as seed from "../seed.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auth: typeof auth;
  books: typeof books;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/lessons": typeof lib_lessons;
  "lib/normalize": typeof lib_normalize;
  media: typeof media;
  mutations: typeof mutations;
  queries: typeof queries;
  seed: typeof seed;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
