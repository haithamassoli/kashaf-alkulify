/**
 * Build-time archive reads for the static article, series and lesson pages and
 * the sitemap. Each loader runs once per build and is shared by every page.
 */
import {
  R2_ACCESS_KEY_ID,
  R2_ARCHIVE_BUCKET,
  R2_ENDPOINT,
  R2_SECRET_ACCESS_KEY,
  VERCEL_ENV,
} from "astro:env/server";
import { AwsClient } from "aws4fetch";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { seriesSlug } from "./paths";

const url: string | undefined = import.meta.env.PUBLIC_CONVEX_URL;

if (!url) {
  throw new Error(
    "PUBLIC_CONVEX_URL is not set — the build reads the archive."
  );
}

const convex = new ConvexHttpClient(url);

// ponytail: `astro dev` renders a sample so a page opens in seconds, not minutes.
const LIMIT = import.meta.env.DEV ? 40 : Number.POSITIVE_INFINITY;

export interface Article {
  date: number;
  id: string;
  telegramUrl: string;
  text: string;
  title: string;
}

export interface SeriesLesson {
  durationMs: number;
  episode: number | null;
  id: string;
  title: string;
}

export interface Series {
  count: number;
  durationMs: number;
  lessons: SeriesLesson[];
  name: string;
  slug: string;
}

export interface Cue {
  startMs: number;
  text: string;
}

export interface Lesson {
  cues: Cue[];
  durationMs: number;
  episode: number | null;
  id: string;
  series: string | null;
  title: string;
}

const once = <T>(load: () => Promise<T>): (() => Promise<T>) => {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= load();
    return pending;
  };
};

/** Maps with at most `limit` calls in flight, keeping input order. */
const pool = async <T, R>(
  items: T[],
  limit: number,
  map: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      // biome-ignore lint/performance/noAwaitInLoops: each worker runs its share in turn; the pool is the parallelism.
      results[index] = await map(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
};

const paginate = async <T>(
  page: (cursor: string | null) => Promise<{
    continueCursor: string;
    isDone: boolean;
    page: T[];
  }>
): Promise<T[]> => {
  const rows: T[] = [];
  let cursor: string | null = null;
  while (rows.length < LIMIT) {
    // biome-ignore lint/performance/noAwaitInLoops: every page needs the previous page's cursor.
    const result = await page(cursor);
    rows.push(...result.page);
    if (result.isDone) {
      break;
    }
    cursor = result.continueCursor;
  }
  return rows.slice(0, LIMIT);
};

export const articles = once(async (): Promise<Article[]> => {
  const list = await paginate((cursor) =>
    convex.query(api.content.articles, {
      paginationOpts: { cursor, numItems: 500 },
      search: "",
    })
  );
  const found = await pool(list, 32, async ({ id }) => {
    const article = await convex.query(api.content.article, { id });
    return article && { ...article, id };
  });
  return found.filter((article) => article !== null);
});

export const series = once(async (): Promise<Series[]> => {
  const list = await paginate((cursor) =>
    convex.query(api.content.series, {
      paginationOpts: { cursor, numItems: 500 },
      search: "",
    })
  );
  const rows = await pool(list, 16, async (row) => ({
    ...row,
    lessons: await convex.query(api.content.seriesLessons, { name: row.name }),
    slug: seriesSlug(row.name),
  }));
  // Names that differ only in encoding are one series; merge them into one page.
  const merged = new Map<string, Series>();
  for (const row of rows) {
    const found = merged.get(row.slug);
    if (found === undefined) {
      merged.set(row.slug, row);
      continue;
    }
    found.count += row.count;
    found.durationMs += row.durationMs;
    found.lessons = [...found.lessons, ...row.lessons].sort(
      (a, b) =>
        (a.episode ?? Number.MAX_SAFE_INTEGER) -
          (b.episode ?? Number.MAX_SAFE_INTEGER) ||
        a.title.localeCompare(b.title, "ar")
    );
  }
  return [...merged.values()].filter((row) => row.lessons.length > 0);
});

const TRAILING_SLASHES = /\/+$/;

const r2 = (): {
  client: AwsClient;
  object: (key: string) => string;
} | null => {
  if (
    !(
      R2_ACCESS_KEY_ID &&
      R2_SECRET_ACCESS_KEY &&
      R2_ENDPOINT &&
      R2_ARCHIVE_BUCKET
    )
  ) {
    return null;
  }
  const base = `${R2_ENDPOINT.replace(TRAILING_SLASHES, "")}/${R2_ARCHIVE_BUCKET}`;
  return {
    client: new AwsClient({
      accessKeyId: R2_ACCESS_KEY_ID,
      region: "auto",
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      service: "s3",
    }),
    object: (key) =>
      `${base}/${key.split("/").map(encodeURIComponent).join("/")}`,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

interface Segment {
  partOrder: number;
  startMs: number;
  text: string;
}

const isSegment = (value: unknown): value is Segment =>
  isRecord(value) &&
  typeof value.partOrder === "number" &&
  typeof value.startMs === "number" &&
  typeof value.text === "string";

export const lessons = once(async (): Promise<Lesson[]> => {
  const archive = r2();
  if (archive === null) {
    // A production build without R2 would publish a sitemap missing every lesson.
    if (VERCEL_ENV === "production") {
      throw new Error(
        "R2 is not configured: set R2_ENDPOINT, R2_ARCHIVE_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY for the build."
      );
    }
    console.warn("[archive] R2 is not configured; skipping lesson pages.");
    return [];
  }

  const rows: Awaited<
    ReturnType<typeof convex.query<typeof api.queries.lessonsPage>>
  >["lessons"] = [];
  let cursor = "";
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: every page needs the previous page's cursor.
    const page = await convex.query(api.queries.lessonsPage, {
      cursor,
      limit: 200,
    });
    rows.push(...page.lessons);
    if (page.nextCursor === null || rows.length >= LIMIT) {
      break;
    }
    cursor = page.nextCursor;
  }

  // Publication is decided exactly where search decides it: a lesson with no
  // live revision is deleted, under review, or missing its current transcript.
  const batches = Array.from({ length: Math.ceil(rows.length / 50) }, (_, i) =>
    rows.slice(i * 50, (i + 1) * 50)
  );
  const live = new Set(
    (
      await pool(batches, 8, (batch) =>
        convex.query(api.search.revisions, { ids: batch.map((row) => row.id) })
      )
    )
      .flat()
      .filter((row) => row.sourceRevision !== null)
      .map((row) => row.sourceId)
  );

  const found = await pool(
    rows.filter((row) => live.has(row.id)).slice(0, LIMIT),
    32,
    async (row): Promise<Lesson | null> => {
      if (row.lessonTranscriptR2Key === null) {
        return null;
      }
      const response = await archive.client.fetch(
        archive.object(row.lessonTranscriptR2Key)
      );
      if (!response.ok) {
        throw new Error(`Transcript for ${row.id}: HTTP ${response.status}`);
      }
      const artifact: unknown = await response.json();
      if (
        !(
          isRecord(artifact) &&
          artifact.lessonId === row.id &&
          artifact.assemblyHash === row.assemblyHash &&
          Array.isArray(artifact.segments)
        )
      ) {
        return null;
      }
      // Same clipping as the search export: a cue past its part's end is dropped.
      const ends = new Map(
        row.parts.map((part) => [part.order, part.offsetMs + part.durationMs])
      );
      const cues = artifact.segments
        .filter(isSegment)
        .filter(
          (segment) => segment.startMs < (ends.get(segment.partOrder) ?? 0)
        )
        .map(({ startMs, text }) => ({ startMs, text: text.trim() }))
        .filter((cue) => cue.text);
      return {
        cues,
        durationMs: row.durationMs,
        episode: row.seriesEpisode,
        id: row.id,
        series: row.seriesName,
        title: row.rawTitle,
      };
    }
  );
  return found.filter((lesson) => lesson !== null);
});
