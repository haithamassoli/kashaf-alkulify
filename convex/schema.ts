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

const schema = defineSchema({
  books: defineTable(bookFields)
    .index("by_slug", ["slug"])
    .index("by_published_and_order", ["published", "order"]),
});

export default schema;
