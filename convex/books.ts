import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  type MutationCtx,
  mutation,
  query,
} from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { normalize } from "./lib/normalize";
import schema, { bookValidator } from "./schema";

const ADMIN_PAGE_SIZE = 500;

const bookDoc = schema.doc("books");

export const searchText = (book: {
  categories: string[];
  description: string;
  title: string;
}) => normalize([book.title, ...book.categories, book.description].join(" "));

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

/** Published books, by `order` or by relevance to `search`. Public. */
export const list = query({
  args: { paginationOpts: paginationOptsValidator, search: v.string() },
  handler: async (ctx, args) => {
    const term = normalize(args.search.slice(0, 200));

    return term
      ? await ctx.db
          .query("books")
          .withSearchIndex("search_text", (q) =>
            q.search("searchText", term).eq("published", true)
          )
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("books")
          .withIndex("by_published_and_order", (q) => q.eq("published", true))
          .paginate(args.paginationOpts);
  },
  returns: paginationResultValidator(bookDoc),
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
      searchText: searchText(fields),
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
    const book = await ctx.db.get("books", id);

    if (book !== null) {
      await ctx.db.patch("books", id, { searchText: searchText(book) });
    }

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

/** Fills `searchText` on books written before it existed. */
export const backfillSearchText = internalMutation({
  args: {},
  handler: async (ctx) => {
    const books = await ctx.db.query("books").take(ADMIN_PAGE_SIZE);

    await Promise.all(
      books.map((book) =>
        ctx.db.patch("books", book._id, { searchText: searchText(book) })
      )
    );

    return books.length;
  },
  returns: v.number(),
});
