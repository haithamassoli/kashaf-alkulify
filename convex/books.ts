import { ConvexError, v } from "convex/values";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import schema, { bookValidator } from "./schema";

const PUBLIC_PAGE_SIZE = 200;
const ADMIN_PAGE_SIZE = 500;

const bookDoc = schema.doc("books");

/** Highest `order` currently in use, or -1 when the table is empty. */
const highestOrder = async (ctx: MutationCtx): Promise<number> => {
  const lastPerBucket = await Promise.all(
    [true, false].map((published) =>
      ctx.db
        .query("books")
        .withIndex("by_published_and_order", (q) =>
          q.eq("published", published)
        )
        .order("desc")
        .take(1)
    )
  );

  return lastPerBucket
    .flat()
    .reduce((highest, book) => Math.max(highest, book.order), -1);
};

/** Published books, ordered by `order` ascending. Public. */
export const list = query({
  args: {},
  handler: async (ctx) =>
    await ctx.db
      .query("books")
      .withIndex("by_published_and_order", (q) => q.eq("published", true))
      .take(PUBLIC_PAGE_SIZE),
  returns: v.array(bookDoc),
});

/** A single published book by slug, or null. Public. */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const book = await ctx.db
      .query("books")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (!book?.published) {
      return null;
    }

    return book;
  },
  returns: v.union(bookDoc, v.null()),
});

/** Every book, including unpublished ones. Admin only. */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    return await ctx.db.query("books").take(ADMIN_PAGE_SIZE);
  },
  returns: v.array(bookDoc),
});

/** Creates a book. Admin only. */
export const create = mutation({
  args: bookValidator.omit("published", "order").extend({
    order: v.optional(v.number()),
    published: v.optional(v.boolean()),
  }).fields,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const existing = await ctx.db
      .query("books")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (existing) {
      throw new ConvexError(
        `المُعرِّف "${args.slug}" مستخدم في كتاب آخر. اختر معرِّفًا غيره.`
      );
    }

    const { published, order, ...fields } = args;

    return await ctx.db.insert("books", {
      ...fields,
      order: order ?? (await highestOrder(ctx)) + 1,
      published: published ?? false,
    });
  },
  returns: v.id("books"),
});

/** Patches the supplied fields of a book. Admin only. */
export const update = mutation({
  args: {
    id: v.id("books"),
    ...bookValidator.partial().fields,
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const { id, ...fields } = args;
    await ctx.db.patch("books", id, fields);

    return null;
  },
  returns: v.null(),
});

/** Deletes a book. Admin only. */
export const remove = mutation({
  args: { id: v.id("books") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.delete("books", args.id);

    return null;
  },
  returns: v.null(),
});

/** Rewrites `order` to match the position of each id in `ids`. Admin only. */
export const reorder = mutation({
  args: { ids: v.array(v.id("books")) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    await Promise.all(
      args.ids.map((id, order) => ctx.db.patch("books", id, { order }))
    );

    return null;
  },
  returns: v.null(),
});
