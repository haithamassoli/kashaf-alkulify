import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx, query } from "./_generated/server";

const scopeValidator = v.union(v.literal("audio"), v.literal("articles"));
const sourceIdValidator = v.union(v.id("lessons"), v.id("articles"));

// Export and live result validation deliberately share the publication rules.
const source = async (ctx: QueryCtx, id: Id<"lessons"> | Id<"articles">) => {
  const row = await ctx.db.get(id);
  if (row === null) {
    return null;
  }
  if ("text" in row) {
    const message = await ctx.db.get("telegramMessages", row.messageId);
    if (message === null || message.deletedAt !== undefined) {
      return null;
    }
    return {
      scope: "articles",
      sourceId: row._id,
      text: row.text,
      title: row.title,
      url: row.telegramUrl,
    };
  }
  if (
    row.deletedAt !== undefined ||
    row.reviewStatus === "needs_review" ||
    !row.lessonTranscriptR2Key?.startsWith(
      `lesson-transcripts/${row._id}/${row.assemblyHash}-`
    )
  ) {
    return null;
  }
  const parts = await ctx.db
    .query("lessonParts")
    .withIndex("by_lesson_order", (q) => q.eq("lessonId", row._id))
    .take(201);
  if (
    parts.length === 0 ||
    parts.length > 200 ||
    parts.length !== row.partCount
  ) {
    return null;
  }
  const resolved = await Promise.all(
    parts.map(async (part) => {
      const object = await ctx.db.get("mediaObjects", part.mediaObjectId);
      const message = part.messageId
        ? await ctx.db.get("telegramMessages", part.messageId)
        : null;
      if (
        object === null ||
        object.deletedAt !== undefined ||
        (part.messageId && message === null) ||
        message?.deletedAt !== undefined ||
        (row.approvedAt !== undefined &&
          message?.editDate !== undefined &&
          row.approvedAt < message.editDate)
      ) {
        return null;
      }
      const { messageId } = part;
      if (messageId) {
        const links = await ctx.db
          .query("messageMedia")
          .withIndex("by_message", (q) => q.eq("messageId", messageId))
          .take(20);
        if (!links.some((link) => link.mediaObjectId === part.mediaObjectId)) {
          return null;
        }
      }
      return {
        durationMs: part.durationMs,
        offsetMs: part.offsetMs,
        order: part.order,
        r2Key: object.r2Key,
        sha256: object.sha256,
      };
    })
  );
  if (resolved.some((part) => part === null)) {
    return null;
  }
  const primary = await ctx.db
    .query("lessonSources")
    .withIndex("by_lesson", (q) => q.eq("lessonId", row._id))
    .first();
  return {
    assemblyHash: row.assemblyHash,
    durationMs: row.durationMs,
    parts: resolved,
    scope: "audio",
    sourceId: row._id,
    title: row.rawTitle,
    transcriptKey: row.lessonTranscriptR2Key,
    url: primary?.url ?? "",
  };
};

const revision = async (value: object): Promise<string> => {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value))
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

// Private CLI export: R2 object keys never enter a public query response.
export const exportPage = internalQuery({
  args: { paginationOpts: paginationOptsValidator, scope: scopeValidator },
  handler: async (ctx, args) => {
    if (args.paginationOpts.numItems > 50) {
      throw new Error("Export pages are limited to 50 sources");
    }
    const table = args.scope === "audio" ? "lessons" : "articles";
    const page = await ctx.db.query(table).paginate(args.paginationOpts);
    const rows = await Promise.all(
      page.page.map(async (row) => {
        const value = await source(ctx, row._id);
        return value === null
          ? null
          : { ...value, sourceRevision: await revision(value) };
      })
    );
    return {
      cursor: page.continueCursor,
      done: page.isDone,
      payload: JSON.stringify(rows.filter((row) => row !== null)),
      scanned: page.page.length,
    };
  },
  returns: v.object({
    cursor: v.string(),
    done: v.boolean(),
    payload: v.string(),
    scanned: v.number(),
  }),
});

// Recheck after retrieval and before returning an excerpt or signing playback.
export const revisions = query({
  args: { ids: v.array(sourceIdValidator) },
  handler: async (ctx, args) => {
    if (args.ids.length > 50) {
      throw new Error("At most 50 source checks per request");
    }
    const rows = await Promise.all(
      args.ids.map(async (id) => {
        const value = await source(ctx, id);
        return {
          sourceId: id,
          sourceRevision: value === null ? null : await revision(value),
        };
      })
    );
    return rows;
  },
  returns: v.array(
    v.object({
      sourceId: sourceIdValidator,
      sourceRevision: v.union(v.string(), v.null()),
    })
  ),
});
