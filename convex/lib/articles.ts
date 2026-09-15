/** An article's photos, shared by the Organizer's upsert and the dashboard. */

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Up to this many photos per article; a Telegram album holds ten. */
const MAX_PHOTOS = 50;

export const photoRows = async (
  ctx: QueryCtx,
  articleId: Id<"articles">
): Promise<Doc<"articlePhotos">[]> =>
  await ctx.db
    .query("articlePhotos")
    .withIndex("by_article_and_order", (q) => q.eq("articleId", articleId))
    .take(MAX_PHOTOS);

/** Replaces the photo list. Returns whether anything changed. */
export const setPhotos = async (
  ctx: MutationCtx,
  articleId: Id<"articles">,
  mediaObjectIds: Id<"mediaObjects">[]
): Promise<boolean> => {
  const wanted = [...new Set(mediaObjectIds)].slice(0, MAX_PHOTOS);
  const rows = await photoRows(ctx, articleId);

  if (
    rows.length === wanted.length &&
    rows.every((row, index) => row.mediaObjectId === wanted[index])
  ) {
    return false;
  }

  for (const row of rows) {
    await ctx.db.delete("articlePhotos", row._id);
  }

  for (const [order, mediaObjectId] of wanted.entries()) {
    await ctx.db.insert("articlePhotos", { articleId, mediaObjectId, order });
  }

  return true;
};

/** The article a photo is linked to, ignoring deleted articles. */
export const photoArticle = async (
  ctx: QueryCtx,
  mediaObjectId: Id<"mediaObjects">
): Promise<Doc<"articles"> | null> => {
  const links = await ctx.db
    .query("articlePhotos")
    .withIndex("by_media_object", (q) => q.eq("mediaObjectId", mediaObjectId))
    .take(10);

  for (const link of links) {
    const article = await ctx.db.get("articles", link.articleId);

    if (article !== null && article.deletedAt === undefined) {
      return article;
    }
  }

  return null;
};

/** R2 keys of the photos an article shows, skipping deleted binaries. */
export const photoKeys = async (
  ctx: QueryCtx,
  articleId: Id<"articles">
): Promise<string[]> => {
  const keys: string[] = [];

  for (const row of await photoRows(ctx, articleId)) {
    const media = await ctx.db.get("mediaObjects", row.mediaObjectId);

    if (media !== null && media.deletedAt === undefined) {
      keys.push(media.r2Key);
    }
  }

  return keys;
};
