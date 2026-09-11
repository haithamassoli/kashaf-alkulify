// Read side for the batch commands: the §4.2 skip fast-path, the §4.6 failure
// drain, and the M1 validation pass.

import { v } from "convex/values";
import { query } from "./_generated/server";

export const channelByUsername = query({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("channels")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .collect();
    return rows[0] ?? null;
  },
});

// §4.2 skip rule for ingest: a message counts as done when its row exists and,
// when it carries a binary, that binary is already linked. A crash between the
// message row and its media leaves the message incomplete, and this reports it
// as such — which is what keeps a resumed run from re-downloading a whole batch.
export const ingestedMessageIds = query({
  args: {
    channelId: v.id("channels"),
    fromId: v.number(),
    toId: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("telegramMessages")
      .withIndex("by_channel_message", (q) =>
        q
          .eq("channelId", args.channelId)
          .gte("telegramMessageId", args.fromId)
          .lte("telegramMessageId", args.toId)
      )
      .collect();
    const done: number[] = [];
    for (const row of rows) {
      if (row.mediaType === "none") {
        done.push(row.telegramMessageId);
        continue;
      }
      const media = await ctx.db
        .query("messageMedia")
        .withIndex("by_message", (q) => q.eq("messageId", row._id))
        .first();
      if (media !== null) {
        done.push(row.telegramMessageId);
      }
    }
    return done;
  },
});

// Asked after hashing a download and before uploading: a binary that already has
// a row keeps that row's r2Key, so the same bytes can never land under two keys
// because a repost arrived with a different filename extension.
export const mediaObjectBySha256 = query({
  args: { sha256: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("mediaObjects")
      .withIndex("by_sha256", (q) => q.eq("sha256", args.sha256))
      .collect();
    if (rows.length > 1) {
      throw new Error(
        `integrity error: ${rows.length} rows for unique mediaObjects.sha256=${args.sha256}`
      );
    }
    return rows[0] ?? null;
  },
});

export const unresolvedFailures = query({
  args: { stage: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("failures")
      .withIndex("by_stage_resolved", (q) =>
        q.eq("stage", args.stage).eq("resolved", false)
      )
      .collect(),
});

// Validation pass (M1 exit): counts, and a page of messages to spot-check
// telegramUrl against live Telegram. Paged by message id — a channel has tens of
// thousands of rows and a single `.collect()` would hit the query read limit.
export const channelScan = query({
  args: {
    channelId: v.id("channels"),
    fromId: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("telegramMessages")
      .withIndex("by_channel_message", (q) =>
        q.eq("channelId", args.channelId).gte("telegramMessageId", args.fromId)
      )
      .take(args.limit);
    let withMedia = 0;
    // A message claiming a binary with no `messageMedia` row is the one failure
    // M1 must never report as archived: the blob is missing, not merely absent.
    const unlinked: number[] = [];
    for (const row of rows) {
      if (row.mediaType === "none") {
        continue;
      }
      withMedia += 1;
      const link = await ctx.db
        .query("messageMedia")
        .withIndex("by_message", (q) => q.eq("messageId", row._id))
        .first();
      if (link === null) {
        unlinked.push(row.telegramMessageId);
      }
    }
    const last = rows.at(-1);
    return {
      count: rows.length,
      ids: rows.map((row) => row.telegramMessageId),
      nextFromId: last === undefined ? null : last.telegramMessageId + 1,
      unlinked,
      withMedia,
    };
  },
});

export const messagesByIds = query({
  args: { channelId: v.id("channels"), ids: v.array(v.number()) },
  handler: async (ctx, args) => {
    const out = [];
    for (const id of args.ids) {
      const row = await ctx.db
        .query("telegramMessages")
        .withIndex("by_channel_message", (q) =>
          q.eq("channelId", args.channelId).eq("telegramMessageId", id)
        )
        .first();
      if (row !== null) {
        out.push(row);
      }
    }
    return out;
  },
});

export const mediaForMessage = query({
  args: { messageId: v.id("telegramMessages") },
  handler: async (ctx, args) => {
    const links = await ctx.db
      .query("messageMedia")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .collect();
    const out = [];
    for (const link of links) {
      const object = await ctx.db.get(link.mediaObjectId);
      if (object !== null) {
        out.push(object);
      }
    }
    return out;
  },
});

// M2 selection (§4.2/§4.3): one page of unique binaries in sha256 order, each
// carrying its part-transcript row for the active configHash. sha256 order makes
// the scan resumable, and joining the transcript here is what lets a worker take
// the fast path without a second round trip per object.
export const mediaObjectsPage = query({
  args: { configHash: v.string(), cursor: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("mediaObjects")
      .withIndex("by_sha256", (q) => q.gt("sha256", args.cursor))
      .take(args.limit);
    const objects = [];
    for (const row of rows) {
      const found = await ctx.db
        .query("partTranscripts")
        .withIndex("by_sha256_config", (q) =>
          q.eq("sha256", row.sha256).eq("configHash", args.configHash)
        )
        .collect();
      if (found.length > 1) {
        throw new Error(
          `integrity error: ${found.length} rows for unique partTranscripts.(${row.sha256},${args.configHash})`
        );
      }
      const transcript = found[0] ?? null;
      objects.push({
        attempts: transcript?.attempts ?? 0,
        durationMs: row.durationMs ?? null,
        ext: row.ext,
        mimeType: row.mimeType ?? null,
        processingStartedAt: transcript?.processingStartedAt ?? null,
        r2Key: row.r2Key,
        rawR2Key: transcript?.rawR2Key ?? null,
        sha256: row.sha256,
        sizeBytes: row.sizeBytes,
        status: transcript?.status ?? null,
      });
    }
    return {
      nextCursor: rows.at(-1)?.sha256 ?? null,
      objects,
    };
  },
});

// M3 selection: one page of a channel's messages in telegramMessageId order,
// each carrying the binaries it links. Ordering by message id is what makes the
// Organizer's "title then the audio that follows it" rule expressible at all,
// and joining the media here saves a round trip per message on a 26k-row scan.
export const messagesPage = query({
  args: {
    channelId: v.id("channels"),
    cursor: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("telegramMessages")
      .withIndex("by_channel_message", (q) =>
        q.eq("channelId", args.channelId).gt("telegramMessageId", args.cursor)
      )
      .take(args.limit);
    const messages = [];
    for (const row of rows) {
      const links = await ctx.db
        .query("messageMedia")
        .withIndex("by_message", (q) => q.eq("messageId", row._id))
        .collect();
      const media = [];
      for (const link of links) {
        const object = await ctx.db.get(link.mediaObjectId);
        if (object === null) {
          throw new Error(
            `integrity error: messageMedia ${link._id} points at a missing mediaObject`
          );
        }
        media.push({
          durationMs: object.durationMs ?? null,
          ext: object.ext,
          mediaObjectId: object._id,
          mimeType: object.mimeType ?? null,
          originalFileName: link.originalFileName ?? null,
          sha256: object.sha256,
        });
      }
      messages.push({
        classifierVersion: row.classifierVersion ?? null,
        date: row.date,
        deletedAt: row.deletedAt ?? null,
        editDate: row.editDate ?? null,
        forwardedFromChannel: row.forwardedFromChannel ?? null,
        groupedId: row.groupedId ?? null,
        id: row._id,
        isForwarded: row.isForwarded,
        media,
        mediaType: row.mediaType,
        replyToMessageId: row.replyToMessageId ?? null,
        semanticType: row.semanticType,
        telegramMessageId: row.telegramMessageId,
        telegramUrl: row.telegramUrl,
        text: row.text ?? null,
      });
    }
    return {
      messages,
      nextCursor: rows.at(-1)?.telegramMessageId ?? null,
    };
  },
});

// Phase 3.5 selection: lessons with their ordered parts. `lessonTranscriptR2Key`
// rides along so the builder can take the §4.2 fast path — a pointer already
// naming the current assemblyHash + configHash means there is nothing to build.
export const lessonsPage = query({
  args: { cursor: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("lessons")
      .withIndex("by_lesson_key", (q) => q.gt("lessonKey", args.cursor))
      .take(args.limit);
    const lessons = [];
    for (const row of rows) {
      const parts = await ctx.db
        .query("lessonParts")
        .withIndex("by_lesson_order", (q) => q.eq("lessonId", row._id))
        .collect();
      parts.sort((a, b) => a.order - b.order);
      const withSha = [];
      for (const part of parts) {
        const object = await ctx.db.get(part.mediaObjectId);
        if (object === null) {
          throw new Error(
            `integrity error: lessonPart ${part._id} points at a missing mediaObject`
          );
        }
        withSha.push({
          durationMs: part.durationMs,
          offsetMs: part.offsetMs,
          order: part.order,
          sha256: object.sha256,
        });
      }
      lessons.push({
        assemblyHash: row.assemblyHash,
        durationMs: row.durationMs,
        id: row._id,
        lessonKey: row.lessonKey,
        lessonTranscriptR2Key: row.lessonTranscriptR2Key ?? null,
        normalizedTitle: row.normalizedTitle,
        parts: withSha,
        rawTitle: row.rawTitle,
        reviewStatus: row.reviewStatus,
        seriesEpisode: row.seriesEpisode ?? null,
        seriesName: row.seriesName ?? null,
      });
    }
    return {
      lessons,
      nextCursor: rows.at(-1)?.lessonKey ?? null,
    };
  },
});
