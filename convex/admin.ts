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
import { internalQuery, mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
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
  rawTitle: v.string(),
  reviewStatus: REVIEW_STATUS,
  seriesEpisode: v.union(v.number(), v.null()),
  seriesName: v.union(v.string(), v.null()),
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
  rawTitle: row.rawTitle,
  reviewStatus: row.reviewStatus,
  seriesEpisode: row.seriesEpisode ?? null,
  seriesName: row.seriesName ?? null,
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
        .paginate(args.paginationOpts);

      return { ...hits, page: hits.page.map(toSummary) };
    }

    const found =
      status === null
        ? await ctx.db
            .query("lessons")
            .order("desc")
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("lessons")
            .withIndex("by_review_status_and_confidence", (q) =>
              q.eq("reviewStatus", status)
            )
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

    if (row === null) {
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

      media.push({
        durationMs: part.durationMs,
        ext: object.ext,
        mimeType: object.mimeType ?? null,
        offsetMs: part.offsetMs,
        order: part.order,
        partId: part._id,
        r2Key: object.r2Key,
        sha256: object.sha256,
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
      sources: sources.map((source) => ({
        id: source._id,
        isPrimary: source.isPrimary,
        sourceType: source.sourceType,
        url: source.url,
      })),
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
 * Reorders a lesson's parts. `order` and `offsetMs` are both rewritten so the
 * virtual timeline the player concatenates over stays contiguous, and
 * `assemblyHash` is recomputed from the new part order — which is what makes the
 * transcript builder rebuild this lesson and nothing else.
 */
export const reorderParts = mutation({
  args: { id: v.id("lessons"), partIds: v.array(v.id("lessonParts")) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const parts = await ctx.db
      .query("lessonParts")
      .withIndex("by_lesson_order", (q) => q.eq("lessonId", args.id))
      .collect();

    if (parts.length !== args.partIds.length) {
      throw new Error(
        `reorder must list every part: got ${args.partIds.length}, lesson has ${parts.length}`
      );
    }

    const byId = new Map(parts.map((part) => [part._id, part]));
    let offsetMs = 0;
    const shas: string[] = [];

    for (const [order, partId] of args.partIds.entries()) {
      const part = byId.get(partId);

      if (part === undefined) {
        throw new Error(`part ${partId} does not belong to lesson ${args.id}`);
      }

      const object = await ctx.db.get("mediaObjects", part.mediaObjectId);

      if (object === null) {
        throw new Error(`part ${partId} points at a missing mediaObject`);
      }

      await ctx.db.patch("lessonParts", partId, { offsetMs, order });
      shas.push(object.sha256);
      offsetMs += part.durationMs;
    }

    // Must match `assembly_hash` in the pipeline (organize.py): sha256 of the
    // canonical JSON of the ordered part sha256s. For an array of hex strings,
    // Python's `json.dumps(..., separators=(",", ":"))` and `JSON.stringify`
    // produce byte-identical output — anything else silently forks the lesson's
    // identity and forces a needless transcript rebuild.
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(shas))
    );
    const assemblyHash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    await ctx.db.patch("lessons", args.id, {
      assemblyHash,
      durationMs: offsetMs,
      // A hand-ordered lesson is reviewed, not auto-grouped.
      reviewStatus: "needs_review",
    });

    return null;
  },
  returns: v.null(),
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
