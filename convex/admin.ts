/**
 * Everything the dashboard at `/admin` reads or writes. Every function here is
 * gated by `requireAdmin`, unlike `mutations.ts` / `queries.ts`, which the
 * Python pipeline calls over the HTTP API with no identity.
 */

import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { recompose, retireLesson, retireMediaIfUnused } from "./lib/lessons";
import { normalize } from "./lib/normalize";
import schema from "./schema";

/**
 * ponytail: counts are index scans capped at `COUNT_CAP` rows per bucket, not a
 * maintained aggregate. Exact while the archive fits (9.8k transcripts, 5.6k
 * lessons today) and honest past it — a capped bucket reports `capped: true` and
 * the UI renders "9999+". Swap in `@convex-dev/aggregate` if a bucket ever caps.
 */
const COUNT_CAP = 12_000;

const REVIEW_STATUS = v.union(
  v.literal("auto"),
  v.literal("needs_review"),
  v.literal("approved")
);

const countValidator = v.object({ capped: v.boolean(), count: v.number() });

const lessonSummary = v.object({
  approvedAt: v.union(v.number(), v.null()),
  durationMs: v.number(),
  groupingConfidence: v.number(),
  id: v.id("lessons"),
  lessonKey: v.string(),
  partCount: v.number(),
  partsLocked: v.boolean(),
  rawTitle: v.string(),
  reviewStatus: REVIEW_STATUS,
  seriesEpisode: v.union(v.number(), v.null()),
  seriesName: v.union(v.string(), v.null()),
  titleLocked: v.boolean(),
  titleParseConfidence: v.number(),
});

/** The list-row shape: the fields the browser shows, with optionals made null. */
const toSummary = (row: Doc<"lessons">) => ({
  approvedAt: row.approvedAt ?? null,
  durationMs: row.durationMs,
  groupingConfidence: row.groupingConfidence,
  id: row._id,
  lessonKey: row.lessonKey,
  partCount: row.partCount,
  partsLocked: row.partsLocked ?? false,
  rawTitle: row.rawTitle,
  reviewStatus: row.reviewStatus,
  seriesEpisode: row.seriesEpisode ?? null,
  seriesName: row.seriesName ?? null,
  titleLocked: row.titleLocked ?? false,
  titleParseConfidence: row.titleParseConfidence,
});

/** Rows matching an index range, capped so the scan can never run away. */
const cappedCount = async (
  rows: Promise<{ length: number }>
): Promise<{ capped: boolean; count: number }> => {
  const { length } = await rows;

  return { capped: length >= COUNT_CAP, count: length };
};

/**
 * The operations panel: sync pulse per channel, live locks, the newest run per
 * stage, and how many failures are still unresolved. Every table it touches is
 * tiny, so it costs a handful of reads and stays cached between pipeline writes.
 *
 * Timestamps come back raw — the browser decides what counts as stale, because a
 * query may not read the wall clock without going stale itself.
 */
export const pulse = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const channels = await ctx.db.query("channels").take(50);
    const locks = await ctx.db.query("pipelineLocks").take(50);
    const recentRuns = await ctx.db
      .query("pipelineRuns")
      .order("desc")
      .take(60);

    // Newest run per stage, in first-seen order — `recentRuns` is already desc.
    const seen = new Set<string>();
    const stages = [];

    for (const run of recentRuns) {
      if (seen.has(run.stage)) {
        continue;
      }

      seen.add(run.stage);
      stages.push(run);
    }

    const unresolved = await ctx.db
      .query("failures")
      .withIndex("by_resolved_and_last_tried", (q) => q.eq("resolved", false))
      .take(COUNT_CAP);

    const byStage: Record<string, number> = {};

    for (const failure of unresolved) {
      byStage[failure.stage] = (byStage[failure.stage] ?? 0) + 1;
    }

    return {
      channels: channels.map((channel) => ({
        id: channel._id,
        lastMessageId: channel.lastMessageId,
        lastSyncAt: channel.lastSyncAt,
        title: channel.title,
        username: channel.username,
      })),
      failures: {
        byStage: Object.entries(byStage)
          .map(([stage, count]) => ({ count, stage }))
          .sort((a, b) => b.count - a.count),
        total: unresolved.length,
      },
      locks: locks.map((lock) => ({
        acquiredAt: lock.acquiredAt,
        heartbeatAt: lock.heartbeatAt,
        id: lock._id,
        owner: lock.owner,
        runId: lock.runId,
        stage: lock.stage,
      })),
      stages: stages.map((run) => ({
        audioDurationMs: run.audioDurationMs ?? null,
        failureCount: run.failureCount,
        finishedAt: run.finishedAt ?? null,
        id: run._id,
        processedCount: run.processedCount,
        runId: run.runId,
        skippedCount: run.skippedCount,
        stage: run.stage,
        startedAt: run.startedAt,
        status: run.status,
        successCount: run.successCount,
        summary: run.summary ?? null,
        wallTimeMs: run.wallTimeMs ?? null,
      })),
    };
  },
});

/** Part transcripts bucketed by status — the §6 coverage counters. */
export const transcriptCoverage = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const statuses = ["done", "pending", "processing", "failed"] as const;
    const counts = await Promise.all(
      statuses.map((status) =>
        cappedCount(
          ctx.db
            .query("partTranscripts")
            .withIndex("by_status", (q) => q.eq("status", status))
            .take(COUNT_CAP)
        )
      )
    );

    return {
      done: counts[0],
      failed: counts[3],
      pending: counts[1],
      processing: counts[2],
    };
  },
  returns: v.object({
    done: countValidator,
    failed: countValidator,
    pending: countValidator,
    processing: countValidator,
  }),
});

/** Lessons bucketed by review status — the review queue's depth. */
export const reviewCounts = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const statuses = ["needs_review", "auto", "approved"] as const;
    const counts = await Promise.all(
      statuses.map((status) =>
        cappedCount(
          ctx.db
            .query("lessons")
            .withIndex("by_review_status", (q) => q.eq("reviewStatus", status))
            .filter((q) => q.eq(q.field("deletedAt"), undefined))
            .take(COUNT_CAP)
        )
      )
    );

    return {
      approved: counts[2],
      auto: counts[1],
      needsReview: counts[0],
    };
  },
  returns: v.object({
    approved: countValidator,
    auto: countValidator,
    needsReview: countValidator,
  }),
});

/**
 * The lesson browser. With `search` it runs the title search index; without it,
 * it pages the review-status index least-confident first, which is the order the
 * review queue is meant to be worked in.
 */
export const lessons = query({
  args: {
    paginationOpts: paginationOptsValidator,
    reviewStatus: v.union(REVIEW_STATUS, v.null()),
    search: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const term = args.search.trim();
    // Bound outside the index-range callbacks: TypeScript will not carry the
    // null check on `args.reviewStatus` into a closure.
    const status = args.reviewStatus;

    if (term.length > 0) {
      const hits = await ctx.db
        .query("lessons")
        .withSearchIndex("search_title", (q) => {
          const search = q.search("normalizedTitle", term);

          return status === null ? search : search.eq("reviewStatus", status);
        })
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
        .paginate(args.paginationOpts);

      return { ...hits, page: hits.page.map(toSummary) };
    }

    const found =
      status === null
        ? await ctx.db
            .query("lessons")
            .order("desc")
            .filter((q) => q.eq(q.field("deletedAt"), undefined))
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("lessons")
            .withIndex("by_review_status_and_confidence", (q) =>
              q.eq("reviewStatus", status)
            )
            .filter((q) => q.eq(q.field("deletedAt"), undefined))
            .paginate(args.paginationOpts);

    return { ...found, page: found.page.map(toSummary) };
  },
  returns: paginationResultValidator(lessonSummary),
});

/** One lesson with its ordered parts, its sources, and its channel. */
export const lesson = query({
  args: { id: v.id("lessons") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get("lessons", args.id);

    // A deleted lesson is gone as far as the dashboard is concerned; the row
    // only survives as the Organizer's tombstone.
    if (row === null || row.deletedAt !== undefined) {
      return null;
    }

    const parts = await ctx.db
      .query("lessonParts")
      .withIndex("by_lesson_order", (q) => q.eq("lessonId", row._id))
      .collect();

    parts.sort((a, b) => a.order - b.order);

    const media = [];

    for (const part of parts) {
      const object = await ctx.db.get("mediaObjects", part.mediaObjectId);

      if (object === null) {
        continue;
      }

      // A repost puts the same bytes under two lessons. The delete button has
      // to say so before it runs, because a shared binary survives the delete
      // and an unshared one is gone from R2 for good.
      const uses = await ctx.db
        .query("lessonParts")
        .withIndex("by_media_object", (q) =>
          q.eq("mediaObjectId", part.mediaObjectId)
        )
        .take(2);

      media.push({
        durationMs: part.durationMs,
        ext: object.ext,
        mimeType: object.mimeType ?? null,
        offsetMs: part.offsetMs,
        order: part.order,
        partId: part._id,
        r2Key: object.r2Key,
        sha256: object.sha256,
        shared: uses.length > 1,
        sizeBytes: object.sizeBytes,
      });
    }

    const sources = await ctx.db
      .query("lessonSources")
      .withIndex("by_lesson", (q) => q.eq("lessonId", row._id))
      .take(20);

    const channel =
      row.channelId === undefined
        ? null
        : await ctx.db.get("channels", row.channelId);

    return {
      ...toSummary(row),
      assemblyHash: row.assemblyHash,
      channelTitle: channel?.title ?? null,
      groupingVersion: row.groupingVersion,
      lessonKey: row.lessonKey,
      lessonTranscriptR2Key: row.lessonTranscriptR2Key ?? null,
      normalizedTitle: row.normalizedTitle,
      parts: media,
      partsLocked: row.partsLocked ?? false,
      sources: sources.map((source) => ({
        id: source._id,
        isPrimary: source.isPrimary,
        sourceType: source.sourceType,
        url: source.url,
      })),
      titleLocked: row.titleLocked ?? false,
    };
  },
});

/** The article browser, newest first, with optional title search. */
export const articles = query({
  args: { paginationOpts: paginationOptsValidator, search: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const term = args.search.trim();

    const found =
      term.length > 0
        ? await ctx.db
            .query("articles")
            .withSearchIndex("search_title", (q) =>
              q.search("normalizedTitle", term)
            )
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("articles")
            .withIndex("by_channel_date")
            .order("desc")
            .paginate(args.paginationOpts);

    return {
      ...found,
      page: found.page.map((row) => ({
        date: row.date,
        id: row._id,
        // The body is only ever previewed in the list; full text stays out of
        // the payload so a page of 25 does not ship a megabyte of prose.
        preview: row.text.slice(0, 240),
        telegramUrl: row.telegramUrl,
        title: row.title,
      })),
    };
  },
});

/** Unresolved failures across every stage, most recently tried first. */
export const failures = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    return await ctx.db
      .query("failures")
      .withIndex("by_resolved_and_last_tried", (q) => q.eq("resolved", false))
      .order("desc")
      .paginate(args.paginationOpts);
  },
  returns: paginationResultValidator(schema.doc("failures")),
});

/**
 * Moves a lesson through the review states. Approving stamps `approvedAt` so a
 * later source edit can be detected; demoting clears it, because the approval it
 * recorded no longer stands.
 */
export const setReviewStatus = mutation({
  args: { id: v.id("lessons"), reviewStatus: REVIEW_STATUS },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    await ctx.db.patch("lessons", args.id, {
      approvedAt: args.reviewStatus === "approved" ? Date.now() : undefined,
      reviewStatus: args.reviewStatus,
    });

    return null;
  },
  returns: v.null(),
});

/**
 * Reorders a lesson's parts. `recompose` rewrites `order` and `offsetMs` so the
 * virtual timeline the player concatenates over stays contiguous, recomputes
 * `assemblyHash` from the new order — which is what makes the transcript builder
 * rebuild this lesson and nothing else — and locks the composition so the next
 * Organizer run cannot put the old order back.
 */
export const reorderParts = mutation({
  args: { id: v.id("lessons"), partIds: v.array(v.id("lessonParts")) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await recompose(ctx, args.id, args.partIds);
    // A hand-ordered lesson is reviewed, not auto-grouped.
    await ctx.db.patch("lessons", args.id, { reviewStatus: "needs_review" });

    return null;
  },
  returns: v.null(),
});

/**
 * Renames a lesson, and with it the series it belongs to.
 *
 * `normalizedTitle` is rewritten from the same contract the Organizer uses, so a
 * renamed lesson is findable by the search index immediately. `titleLocked` is
 * what makes the rename outlive the next pipeline run: the Organizer keeps
 * owning every other field on the row and stops owning this one.
 */
export const setLessonTitle = mutation({
  args: {
    id: v.id("lessons"),
    rawTitle: v.string(),
    seriesEpisode: v.union(v.number(), v.null()),
    seriesName: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const rawTitle = args.rawTitle.trim();
    const seriesName = args.seriesName?.trim() || null;

    await ctx.db.patch("lessons", args.id, {
      normalizedSeriesName:
        seriesName === null ? undefined : normalize(seriesName),
      normalizedTitle: normalize(rawTitle),
      rawTitle,
      seriesEpisode: args.seriesEpisode ?? undefined,
      seriesName: seriesName ?? undefined,
      // A hand-written title is as good as it gets; the review queue sorts by
      // this and should stop offering a lesson a human has already named.
      titleLocked: true,
      titleParseConfidence: 1,
    });

    return null;
  },
  returns: v.null(),
});

/**
 * Moves one part from the lesson it is in to another, appending it at the end.
 *
 * This is the repair for a lesson the grouper split in two: the stray parts get
 * carried over one at a time, and both lessons come out of it with a contiguous
 * timeline and a locked composition. A lesson left with no parts is retired —
 * an empty lesson is not a lesson, and leaving one behind would put a silent row
 * in the review queue forever.
 */
export const movePart = mutation({
  args: { partId: v.id("lessonParts"), toLessonId: v.id("lessons") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const part = await ctx.db.get("lessonParts", args.partId);

    if (part === null) {
      throw new Error(`no lessonPart ${args.partId}`);
    }

    if (part.lessonId === args.toLessonId) {
      return null;
    }

    const target = await ctx.db.get("lessons", args.toLessonId);

    if (target === null || target.deletedAt !== undefined) {
      throw new Error(`no lesson ${args.toLessonId}`);
    }

    const from = part.lessonId;
    const last = await ctx.db
      .query("lessonParts")
      .withIndex("by_lesson_order", (q) => q.eq("lessonId", args.toLessonId))
      .order("desc")
      .first();

    // `recompose` fixes the arithmetic; this only has to land the row past the
    // end of the target so the sort it reads puts the part last.
    await ctx.db.patch("lessonParts", args.partId, {
      lessonId: args.toLessonId,
      offsetMs: 0,
      order: (last?.order ?? -1) + 1,
    });

    const left = await recompose(ctx, from);

    await recompose(ctx, args.toLessonId);
    await ctx.db.patch("lessons", args.toLessonId, {
      reviewStatus: "needs_review",
    });

    if (left === 0) {
      await retireLesson(ctx, from);
    } else {
      await ctx.db.patch("lessons", from, { reviewStatus: "needs_review" });
    }

    return null;
  },
  returns: v.null(),
});

/**
 * Deletes one audio part, and the binary behind it when nothing else plays it.
 *
 * Internal, and run from `media.purge`: the R2 blob has to go in the same breath
 * as the row, and only an action can reach R2. The rows go first — an orphaned
 * blob is a cleanup job, whereas a row pointing at a blob that is already gone
 * is a broken player.
 *
 * @returns the R2 keys the action must delete.
 */
export const deletePartRows = internalMutation({
  args: { partId: v.id("lessonParts") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const part = await ctx.db.get("lessonParts", args.partId);

    if (part === null) {
      return { r2Keys: [] };
    }

    const { lessonId, mediaObjectId } = part;

    await ctx.db.delete("lessonParts", args.partId);

    if ((await recompose(ctx, lessonId)) === 0) {
      await retireLesson(ctx, lessonId);
    }

    const key = await retireMediaIfUnused(ctx, mediaObjectId);

    return { r2Keys: key === null ? [] : [key] };
  },
  returns: v.object({ r2Keys: v.array(v.string()) }),
});

/**
 * Deletes a whole lesson: parts, sources, and every binary no other lesson is
 * still playing. The lesson row itself survives as its own tombstone — see
 * `lessons.deletedAt` in the schema.
 *
 * @returns the R2 keys the action must delete.
 */
export const deleteLessonRows = internalMutation({
  args: { id: v.id("lessons") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const row = await ctx.db.get("lessons", args.id);

    if (row === null || row.deletedAt !== undefined) {
      return { r2Keys: [] };
    }

    const parts = await ctx.db
      .query("lessonParts")
      .withIndex("by_lesson_order", (q) => q.eq("lessonId", args.id))
      .collect();

    // Retire the lesson first: `retireMediaIfUnused` asks whether any part still
    // references the binary, and the parts about to be deleted must not count
    // as that reference.
    await retireLesson(ctx, args.id);

    const r2Keys = [];

    for (const part of parts) {
      const key = await retireMediaIfUnused(ctx, part.mediaObjectId);

      if (key !== null) {
        r2Keys.push(key);
      }
    }

    return { r2Keys };
  },
  returns: v.object({ r2Keys: v.array(v.string()) }),
});

/** Marks a failure handled without waiting for the pipeline to retry it. */
export const dismissFailure = mutation({
  args: { id: v.id("failures") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.patch("failures", args.id, { resolved: true });

    return null;
  },
  returns: v.null(),
});

/**
 * The r2 keys of a lesson's parts, in playback order. Internal: only
 * `media.lessonUrls` calls it, and it runs the same admin check as every public
 * function here so signing cannot be reached without an admin identity.
 */
export const lessonPartKeys = internalQuery({
  args: { id: v.id("lessons") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const parts = await ctx.db
      .query("lessonParts")
      .withIndex("by_lesson_order", (q) => q.eq("lessonId", args.id))
      .collect();

    parts.sort((a, b) => a.order - b.order);

    const keys = [];

    for (const part of parts) {
      const object = await ctx.db.get("mediaObjects", part.mediaObjectId);

      if (object === null) {
        continue;
      }

      keys.push({
        durationMs: part.durationMs,
        mimeType: object.mimeType ?? null,
        offsetMs: part.offsetMs,
        order: part.order,
        partId: part._id,
        r2Key: object.r2Key,
      });
    }

    return keys;
  },
  returns: v.array(
    v.object({
      durationMs: v.number(),
      mimeType: v.union(v.string(), v.null()),
      offsetMs: v.number(),
      order: v.number(),
      partId: v.id("lessonParts"),
      r2Key: v.string(),
    })
  ),
});
