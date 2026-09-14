import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";

const MAX_LESSONS = 6000;

const publishedLesson = (lesson: {
  _id: string;
  assemblyHash: string;
  deletedAt?: number;
  lessonTranscriptR2Key?: string;
  reviewStatus: "approved" | "auto" | "needs_review";
}) =>
  lesson.deletedAt === undefined &&
  lesson.reviewStatus !== "needs_review" &&
  lesson.lessonTranscriptR2Key?.startsWith(
    `lesson-transcripts/${lesson._id}/${lesson.assemblyHash}-`
  );

const articleSummary = v.object({
  date: v.number(),
  id: v.id("articles"),
  preview: v.string(),
  title: v.string(),
});

export const series = query({
  args: {},
  handler: async (ctx) => {
    // ponytail: bounded scan while the archive has ~5.6k lessons; add a series
    // table only when this ceiling is reached.
    const lessons = await ctx.db
      .query("lessons")
      .withIndex("by_series_name")
      .take(MAX_LESSONS);
    const rows = new Map<
      string,
      { count: number; durationMs: number; name: string }
    >();

    for (const lesson of lessons) {
      const name = lesson.seriesName?.trim();

      if (!(name && publishedLesson(lesson))) {
        continue;
      }

      const row = rows.get(name) ?? { count: 0, durationMs: 0, name };
      row.count += 1;
      row.durationMs += lesson.durationMs;
      rows.set(name, row);
    }

    return [...rows.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "ar")
    );
  },
  returns: v.array(
    v.object({
      count: v.number(),
      durationMs: v.number(),
      name: v.string(),
    })
  ),
});

export const seriesLessons = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    if (args.name.length > 200) {
      return [];
    }

    // ponytail: same bounded scan as `series`; index seriesName when the archive
    // reaches MAX_LESSONS or this query becomes measurably slow.
    const lessons = await ctx.db
      .query("lessons")
      .withIndex("by_series_name", (index) => index.eq("seriesName", args.name))
      .take(MAX_LESSONS);

    return lessons
      .filter(
        (lesson) => lesson.seriesName === args.name && publishedLesson(lesson)
      )
      .sort(
        (a, b) =>
          (a.seriesEpisode ?? Number.MAX_SAFE_INTEGER) -
            (b.seriesEpisode ?? Number.MAX_SAFE_INTEGER) ||
          a.rawTitle.localeCompare(b.rawTitle, "ar")
      )
      .map((lesson) => ({
        durationMs: lesson.durationMs,
        episode: lesson.seriesEpisode ?? null,
        id: lesson._id,
        title: lesson.rawTitle,
      }));
  },
  returns: v.array(
    v.object({
      durationMs: v.number(),
      episode: v.union(v.number(), v.null()),
      id: v.id("lessons"),
      title: v.string(),
    })
  ),
});

export const articles = query({
  args: { paginationOpts: paginationOptsValidator, search: v.string() },
  handler: async (ctx, args) => {
    const term = args.search.trim();
    const found = term
      ? await ctx.db
          .query("articles")
          .withSearchIndex("search_title", (search) =>
            search.search("normalizedTitle", term)
          )
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("articles")
          .withIndex("by_channel_date")
          .order("desc")
          .paginate(args.paginationOpts);
    const page = (
      await Promise.all(
        found.page.map(async (row) => {
          const message = await ctx.db.get("telegramMessages", row.messageId);

          return message === null || message.deletedAt !== undefined
            ? null
            : {
                date: row.date,
                id: row._id,
                preview: row.text.slice(0, 220),
                title: row.title,
              };
        })
      )
    ).filter((row) => row !== null);

    return { ...found, page };
  },
  returns: paginationResultValidator(articleSummary),
});

export const article = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("articles", args.id);

    if (id === null) {
      return null;
    }

    const row = await ctx.db.get("articles", id);

    if (row === null) {
      return null;
    }

    const message = await ctx.db.get("telegramMessages", row.messageId);

    if (message === null || message.deletedAt !== undefined) {
      return null;
    }

    return {
      date: row.date,
      telegramUrl: row.telegramUrl,
      text: row.text,
      title: row.title,
    };
  },
  returns: v.union(
    v.object({
      date: v.number(),
      telegramUrl: v.string(),
      text: v.string(),
      title: v.string(),
    }),
    v.null()
  ),
});
