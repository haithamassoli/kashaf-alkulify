import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const bookFields = {
  categories: v.array(v.string()),
  /** ISO `yyyy-mm-dd`, or null when the source has no date. */
  date: v.union(v.string(), v.null()),
  description: v.string(),
  /** Google Drive PDF link. */
  downloadUrl: v.union(v.string(), v.null()),
  /** Manual sort position; lower sorts first. */
  order: v.number(),
  published: v.boolean(),
  /** Stable URL key. */
  slug: v.string(),
  sourceUrl: v.union(v.string(), v.null()),
  title: v.string(),
};

export const bookValidator = v.object(bookFields);

/** A book without the fields the seeder derives (`published`, `order`). */
export const bookSeedValidator = bookValidator.omit("published", "order");

// The archive pipeline (telegram-archive) and this site share one deployment,
// so they share one schema. Uniqueness on sha256 / (sha256,configHash) /
// lessonKey / stage is NOT enforced by these indexes; it is enforced by the
// atomic mutations in mutations.ts, which are serializable (plan §0 item 3).
const schema = defineSchema({
  articles: defineTable({
    channelId: v.id("channels"),
    date: v.number(),
    indexedAt: v.optional(v.number()),
    indexVersion: v.optional(v.string()),
    messageId: v.id("telegramMessages"),
    normalizedText: v.string(),
    normalizedTitle: v.string(),
    telegramUrl: v.string(),
    text: v.string(),
    title: v.string(),
    titleSource: v.string(),
  })
    .index("by_message", ["messageId"])
    .index("by_channel_date", ["channelId", "date"]),
  books: defineTable(bookFields)
    .index("by_slug", ["slug"])
    .index("by_published_and_order", ["published", "order"]),

  channels: defineTable({
    lastMessageId: v.number(),
    lastSyncAt: v.number(),
    title: v.string(),
    username: v.string(),
  }).index("by_username", ["username"]),

  failures: defineTable({
    attempts: v.number(),
    error: v.string(),
    lastTriedAt: v.number(),
    refKey: v.string(),
    resolved: v.boolean(),
    stage: v.string(),
  })
    .index("by_stage_resolved", ["stage", "resolved"])
    .index("by_stage_ref", ["stage", "refKey"]),

  lessonParts: defineTable({
    durationMs: v.number(),
    lessonId: v.id("lessons"),
    mediaObjectId: v.id("mediaObjects"),
    messageId: v.optional(v.id("telegramMessages")),
    offsetMs: v.number(),
    order: v.number(),
  })
    .index("by_lesson_order", ["lessonId", "order"])
    .index("by_message", ["messageId"]),

  lessonSources: defineTable({
    channelId: v.optional(v.id("channels")),
    externalId: v.optional(v.string()),
    isPrimary: v.boolean(),
    lessonId: v.id("lessons"),
    messageId: v.optional(v.id("telegramMessages")),
    metadata: v.optional(v.any()),
    sourceType: v.union(
      v.literal("telegram"),
      v.literal("youtube"),
      v.literal("legacy")
    ),
    url: v.string(),
  }).index("by_lesson", ["lessonId"]),

  lessons: defineTable({
    // Ordered part sha256s only (§0 amendment 3).
    assemblyHash: v.string(),
    channelId: v.optional(v.id("channels")), // null for non-Telegram sources
    durationMs: v.number(),
    firstTelegramMessageId: v.optional(v.id("telegramMessages")),
    groupingConfidence: v.number(),
    groupingVersion: v.string(),
    indexedAt: v.optional(v.number()),
    indexVersion: v.optional(v.string()),
    lastTelegramMessageId: v.optional(v.id("telegramMessages")),
    // Deterministic from channel + title msgId + first source msgId.
    lessonKey: v.string(),
    lessonPartLabel: v.optional(v.string()),
    // No mergeStatus / mergedR2Key / mergedSha256: plan v2.4 removed merging.
    // A lesson stays a list of parts and the player concatenates them over the
    // virtual timeline lessonParts.offsetMs already defines.
    lessonTranscriptR2Key: v.optional(v.string()),
    normalizedSeriesName: v.optional(v.string()),
    normalizedTitle: v.string(),
    partCount: v.number(),
    rawTitle: v.string(),
    reviewStatus: v.union(
      v.literal("auto"),
      v.literal("needs_review"),
      v.literal("approved")
    ),
    seriesEpisode: v.optional(v.number()),
    seriesName: v.optional(v.string()),
    titleMessageId: v.optional(v.id("telegramMessages")),
    titleParseConfidence: v.number(),
    titleParserVersion: v.string(),
  })
    .index("by_lesson_key", ["lessonKey"])
    .index("by_review_status", ["reviewStatus"]),

  // One row per unique binary. Identity = sha256.
  mediaObjects: defineTable({
    channelCount: v.optional(v.number()),
    codec: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    ext: v.string(),
    firstSeenAt: v.number(),
    mimeType: v.optional(v.string()),
    r2Key: v.string(),
    sampleRate: v.optional(v.number()),
    sha256: v.string(),
    sizeBytes: v.number(),
  }).index("by_sha256", ["sha256"]),

  // Occurrence -> binary. A repost adds a row here only.
  messageMedia: defineTable({
    mediaObjectId: v.id("mediaObjects"),
    messageId: v.id("telegramMessages"),
    originalFileName: v.optional(v.string()),
    // MTProto document.id — reference only; the durable re-download path is
    // (channel, msgId).
    telegramDocId: v.optional(v.string()),
  })
    .index("by_message", ["messageId"])
    .index("by_media_object", ["mediaObjectId"]),

  partTranscripts: defineTable({
    attempts: v.number(),
    configHash: v.string(),
    durationMs: v.optional(v.number()),
    error: v.optional(v.string()),
    model: v.optional(v.string()),
    modelRevision: v.optional(v.string()),
    processingRunId: v.optional(v.string()),
    processingStartedAt: v.optional(v.number()),
    rawR2Key: v.optional(v.string()),
    segmentCount: v.optional(v.number()),
    sha256: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("done"),
      v.literal("failed")
    ),
  }).index("by_sha256_config", ["sha256", "configHash"]),

  // Singleton per stage; uniqueness via acquirePipelineStage.
  pipelineLocks: defineTable({
    acquiredAt: v.number(),
    heartbeatAt: v.number(),
    owner: v.string(),
    runId: v.string(),
    stage: v.string(),
  }).index("by_stage", ["stage"]),

  // Append-only history.
  pipelineRuns: defineTable({
    audioDurationMs: v.optional(v.number()),
    failureCount: v.number(),
    finishedAt: v.optional(v.number()),
    processedCount: v.number(),
    runId: v.string(),
    skippedCount: v.number(),
    stage: v.string(),
    startedAt: v.number(),
    status: v.string(),
    successCount: v.number(),
    summary: v.optional(v.string()),
    wallTimeMs: v.optional(v.number()),
  })
    .index("by_stage_started", ["stage", "startedAt"])
    .index("by_run", ["runId"]),

  telegramMessages: defineTable({
    channelId: v.id("channels"),
    classifierVersion: v.optional(v.string()),
    date: v.number(),
    deletedAt: v.optional(v.number()),
    editDate: v.optional(v.number()),
    forwardedFromChannel: v.optional(v.string()),
    forwardedFromMsgId: v.optional(v.number()),
    groupedId: v.optional(v.string()),
    isForwarded: v.boolean(),
    mediaType: v.union(
      v.literal("none"),
      v.literal("audio"),
      v.literal("voice"),
      v.literal("video"),
      v.literal("photo"),
      v.literal("document")
    ),
    replyToMessageId: v.optional(v.number()),
    semanticType: v.union(
      v.literal("article"),
      v.literal("lesson_title"),
      v.literal("link"),
      v.literal("notice"),
      v.literal("other"),
      v.null()
    ),
    telegramMessageId: v.number(),
    telegramUrl: v.string(),
    text: v.optional(v.string()),
  })
    .index("by_channel_message", ["channelId", "telegramMessageId"])
    .index("by_channel_date", ["channelId", "date"]),
});

export default schema;
