/**
 * Playback URLs for the dashboard's audio player.
 *
 * The archive bucket is private, so the browser cannot fetch `r2Key` directly.
 * This signs a short-lived GET per part instead of proxying the bytes through
 * Convex — a lesson part is 10–40 MB and an action has neither the response size
 * budget nor the streaming to relay that.
 *
 * No `"use node"`: `aws4fetch` signs with Web Crypto, which the default Convex
 * runtime provides, and the default runtime starts an order of magnitude faster.
 */

import { AwsClient } from "aws4fetch";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, env } from "./_generated/server";

/**
 * Annotated by hand: `internal.admin.lessonPartKeys` reaches this file back
 * through the generated `internal` object, and TypeScript cannot resolve the
 * cycle without a declared type here.
 */
interface PartKey {
  durationMs: number;
  mimeType: string | null;
  offsetMs: number;
  order: number;
  partId: Id<"lessonParts">;
  r2Key: string;
}

const TRAILING_SLASHES = /\/+$/;

/** How long a playback URL stays valid. Long enough for a two-hour lesson. */
const EXPIRES_SECONDS = 6 * 60 * 60;

/** A signer plus the object-URL builder for the archive bucket. */
const archive = (): {
  client: AwsClient;
  url: (r2Key: string) => URL;
} => {
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const endpoint = env.R2_ENDPOINT;
  const bucket = env.R2_ARCHIVE_BUCKET;

  if (!(accessKeyId && secretAccessKey && endpoint && bucket)) {
    throw new Error(
      "R2 is not configured: set R2_ENDPOINT, R2_ARCHIVE_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY on this deployment."
    );
  }

  const base = endpoint.replace(TRAILING_SLASHES, "");

  return {
    client: new AwsClient({
      accessKeyId,
      region: "auto",
      secretAccessKey,
      service: "s3",
    }),
    url: (r2Key: string) =>
      new URL(
        `${base}/${bucket}/${r2Key.split("/").map(encodeURIComponent).join("/")}`
      ),
  };
};

export const lessonUrls = action({
  args: { lessonId: v.id("lessons") },
  handler: async (ctx, args) => {
    // Authorization lives in the query: an action has no `ctx.db`, and the
    // identity check must read the Better Auth user the same way every other
    // admin function does.
    const parts: PartKey[] = await ctx.runQuery(internal.admin.lessonPartKeys, {
      id: args.lessonId,
    });

    const { client, url: objectUrl } = archive();

    return await Promise.all(
      parts.map(async (part) => {
        const url = objectUrl(part.r2Key);

        url.searchParams.set("X-Amz-Expires", String(EXPIRES_SECONDS));

        const signed = await client.sign(url.toString(), {
          aws: { signQuery: true },
        });

        return {
          durationMs: part.durationMs,
          mimeType: part.mimeType,
          offsetMs: part.offsetMs,
          order: part.order,
          partId: part.partId,
          url: signed.url,
        };
      })
    );
  },
  returns: v.array(
    v.object({
      durationMs: v.number(),
      mimeType: v.union(v.string(), v.null()),
      offsetMs: v.number(),
      order: v.number(),
      partId: v.id("lessonParts"),
      url: v.string(),
    })
  ),
});

/**
 * Deletes a lesson or one of its parts, rows first and then the audio itself.
 *
 * Authorization lives in the mutations, the same way `lessonUrls` leaves it to
 * `lessonPartKeys`: an action has no `ctx.db` and cannot read the Better Auth
 * user. Neither mutation returns an R2 key it has not already detached from
 * every lesson, so a failed DELETE here leaves a stray blob and nothing worse —
 * whereas deleting the blob first would leave the dashboard playing silence.
 */
export const purge = action({
  args: {
    target: v.union(
      v.object({ id: v.id("lessons"), kind: v.literal("lesson") }),
      v.object({ id: v.id("lessonParts"), kind: v.literal("part") })
    ),
  },
  // Both annotations are by hand for the same reason `PartKey` is: the delete
  // mutations reach this file back through the generated `internal` object, and
  // TypeScript cannot resolve that cycle on its own.
  handler: async (ctx, args): Promise<{ deleted: number }> => {
    const { r2Keys }: { r2Keys: string[] } =
      args.target.kind === "lesson"
        ? await ctx.runMutation(internal.admin.deleteLessonRows, {
            id: args.target.id,
          })
        : await ctx.runMutation(internal.admin.deletePartRows, {
            partId: args.target.id,
          });

    if (r2Keys.length === 0) {
      return { deleted: 0 };
    }

    const { client, url } = archive();

    await Promise.all(
      r2Keys.map(async (r2Key) => {
        const response = await client.fetch(url(r2Key).toString(), {
          method: "DELETE",
        });

        // R2 answers 204 for a key that was never there, so anything else is a
        // real failure and the admin has to hear about it: the rows are already
        // gone and only the blob is left to clean up by hand.
        if (!response.ok) {
          throw new Error(
            `R2 refused to delete ${r2Key}: ${response.status} ${response.statusText}`
          );
        }
      })
    );

    return { deleted: r2Keys.length };
  },
  returns: v.object({ deleted: v.number() }),
});
