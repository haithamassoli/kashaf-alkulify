/**
 * The one routine every hand edit to a lesson's composition ends in.
 *
 * Reorder, move a part to another lesson, delete a part — each of them leaves
 * the lesson's timeline inconsistent until `recompose` rewrites it. Keeping that
 * arithmetic in one place is what stops three call sites from drifting on the
 * detail that matters: `assemblyHash` is the lesson's composition identity, and
 * the transcript builder rebuilds exactly the lessons whose hash moved.
 */

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Must match `assembly_hash` in the pipeline (organize.py): sha256 of the
 * canonical JSON of the ordered part sha256s. For an array of hex strings,
 * Python's `json.dumps(..., separators=(",", ":"))` and `JSON.stringify`
 * produce byte-identical output — anything else silently forks the lesson's
 * identity and forces a needless transcript rebuild.
 */
const assemblyHash = async (shas: string[]): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(shas))
  );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

/**
 * Rewrites a lesson from the parts it has right now: `order` and `offsetMs` made
 * contiguous so the player's virtual timeline has no gap, then `assemblyHash`,
 * `partCount` and `durationMs` derived from the result. Every caller gets those
 * three for free, so none of them has to keep a running count of its own.
 *
 * `order` optionally imposes a new sequence; it must name every part the lesson
 * has, which is the caller's way of saying "I mean this exact arrangement".
 *
 * @returns how many parts the lesson has left.
 */
export const recompose = async (
  ctx: MutationCtx,
  lessonId: Id<"lessons">,
  order?: Id<"lessonParts">[]
): Promise<number> => {
  const parts = await ctx.db
    .query("lessonParts")
    .withIndex("by_lesson_order", (q) => q.eq("lessonId", lessonId))
    .collect();

  parts.sort((a, b) => a.order - b.order);

  if (order !== undefined) {
    if (order.length !== parts.length) {
      throw new Error(
        `reorder must list every part: got ${order.length}, lesson has ${parts.length}`
      );
    }

    const byId = new Map(parts.map((part) => [part._id, part]));

    parts.length = 0;

    for (const partId of order) {
      const part = byId.get(partId);

      if (part === undefined) {
        throw new Error(`part ${partId} does not belong to lesson ${lessonId}`);
      }

      parts.push(part);
    }
  }

  let offsetMs = 0;
  const shas: string[] = [];

  for (const [index, part] of parts.entries()) {
    const object = await ctx.db.get("mediaObjects", part.mediaObjectId);

    if (object === null) {
      throw new Error(`part ${part._id} points at a missing mediaObject`);
    }

    if (part.order !== index || part.offsetMs !== offsetMs) {
      await ctx.db.patch("lessonParts", part._id, { offsetMs, order: index });
    }

    shas.push(object.sha256);
    offsetMs += part.durationMs;
  }

  await ctx.db.patch("lessons", lessonId, {
    assemblyHash: await assemblyHash(shas),
    durationMs: offsetMs,
    partCount: parts.length,
    // A hand-arranged composition outranks the Organizer from here on.
    partsLocked: true,
  });

  return parts.length;
};

/**
 * Retires a lesson: its parts and sources go, the row itself only gets a
 * `deletedAt`. The row is the tombstone — `lessonKey` is the only thing that can
 * tell the Organizer not to compose this lesson again on the next channel scan.
 */
export const retireLesson = async (
  ctx: MutationCtx,
  lessonId: Id<"lessons">
): Promise<void> => {
  const parts = await ctx.db
    .query("lessonParts")
    .withIndex("by_lesson_order", (q) => q.eq("lessonId", lessonId))
    .collect();

  for (const part of parts) {
    await ctx.db.delete("lessonParts", part._id);
  }

  const sources = await ctx.db
    .query("lessonSources")
    .withIndex("by_lesson", (q) => q.eq("lessonId", lessonId))
    .collect();

  for (const source of sources) {
    await ctx.db.delete("lessonSources", source._id);
  }

  await ctx.db.patch("lessons", lessonId, {
    deletedAt: Date.now(),
    durationMs: 0,
    partCount: 0,
  });
};

/**
 * Retires a binary if nothing else is still playing it, and reports the R2 key
 * the caller has to delete.
 *
 * A repost puts the same bytes under two lessons. Deleting one of those lessons
 * must not silence the other, so the blob only goes when the last `lessonParts`
 * row referencing it has gone. The `mediaObjects` row itself always survives:
 * ingest counts a message as archived by the presence of its media link, and
 * removing the row would make the next sync re-download a file the admin
 * deliberately threw away.
 *
 * @returns the R2 key to delete, or null when the binary is still in use.
 */
export const retireMediaIfUnused = async (
  ctx: MutationCtx,
  mediaObjectId: Id<"mediaObjects">
): Promise<string | null> => {
  const stillUsed = await ctx.db
    .query("lessonParts")
    .withIndex("by_media_object", (q) => q.eq("mediaObjectId", mediaObjectId))
    .first();

  if (stillUsed !== null) {
    return null;
  }

  const object = await ctx.db.get("mediaObjects", mediaObjectId);

  if (object === null || object.deletedAt !== undefined) {
    return null;
  }

  await ctx.db.patch("mediaObjects", mediaObjectId, { deletedAt: Date.now() });

  // The part transcripts describe bytes that are about to stop existing. Left
  // behind they would keep the §6 coverage counters claiming work that can
  // never be redone.
  const transcripts = await ctx.db
    .query("partTranscripts")
    .withIndex("by_sha256_config", (q) => q.eq("sha256", object.sha256))
    .collect();

  for (const transcript of transcripts) {
    await ctx.db.delete("partTranscripts", transcript._id);
  }

  return object.r2Key;
};
