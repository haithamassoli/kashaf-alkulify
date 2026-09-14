import { ConvexProvider, usePaginatedQuery } from "convex/react";
import {
  type ChangeEvent,
  type ReactNode,
  useDeferredValue,
  useState,
} from "react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { convex } from "../lib/convex";
import { arabicDate } from "../lib/format";
import { LoadMore, Skeleton } from "./list-parts";

const PAGE_SIZE = 20;

const SUMMARY_LENGTH = 180;

const summary = (text: string) =>
  text.length > SUMMARY_LENGTH
    ? `${text.slice(0, SUMMARY_LENGTH).trimEnd()}…`
    : text;

const primary =
  "inline-flex min-h-11 items-center rounded-lg bg-accent px-4 font-medium text-accent-fg text-sm";
const secondary =
  "inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm transition-colors hover:bg-surface-2";

const BookCard = ({ book }: { book: Doc<"books"> }) => (
  <li className="card flex flex-col p-5">
    <h2 className="font-semibold leading-relaxed">{book.title}</h2>
    {book.date && (
      <bdi className="mt-1 text-muted text-sm">{arabicDate(book.date)}</bdi>
    )}
    <p className="mt-3 text-muted text-sm leading-7">
      {summary(book.description)}
    </p>

    {book.categories.length > 0 && (
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {book.categories.map((category) => (
          <li
            className="rounded-md bg-surface-2 px-2 py-1 text-muted text-xs"
            key={category}
          >
            {category}
          </li>
        ))}
      </ul>
    )}

    <div className="mt-auto flex flex-wrap gap-2 pt-5">
      {book.downloadUrl && (
        <a
          className={primary}
          href={book.downloadUrl}
          rel="noopener"
          target="_blank"
        >
          قراءة وتنزيل PDF
        </a>
      )}
      {book.sourceUrl && (
        <a
          className={secondary}
          href={book.sourceUrl}
          rel="noopener"
          target="_blank"
        >
          صفحة الكتاب
        </a>
      )}
    </div>
  </li>
);

const Books = (): ReactNode => {
  const [filter, setFilter] = useState("");
  const search = useDeferredValue(filter.trim());
  const { loadMore, results, status } = usePaginatedQuery(
    api.books.list,
    { search },
    { initialNumItems: PAGE_SIZE }
  );
  const handleFilter = (event: ChangeEvent<HTMLInputElement>) =>
    setFilter(event.target.value);
  const handleMore = () => loadMore(PAGE_SIZE);

  return (
    <>
      <label className="sr-only" htmlFor="book-filter">
        ابحث في الكتب
      </label>
      <input
        autoComplete="off"
        className="mt-6 w-full rounded-xl border border-border-strong bg-surface px-4 py-3 text-base placeholder:text-muted"
        data-search-input
        id="book-filter"
        onChange={handleFilter}
        placeholder="ابحث في الكتب"
        type="search"
        value={filter}
      />

      {status === "LoadingFirstPage" && (
        <Skeleton className="mt-6 grid gap-3 sm:grid-cols-2" rows={4} />
      )}
      {status !== "LoadingFirstPage" && results.length === 0 && (
        <p className="mt-6 text-muted text-sm">
          {search ? "لا نتائج." : "لا توجد كتب بعد."}
        </p>
      )}

      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {results.map((book) => (
          <BookCard book={book} key={book._id} />
        ))}
      </ul>

      <LoadMore onMore={handleMore} status={status} />
    </>
  );
};

/**
 * The books grid, live from Convex: an admin edit lands here over the open
 * subscription, with no rebuild of the static page around it.
 */
export const BooksList = () => (
  <ConvexProvider client={convex}>
    <Books />
  </ConvexProvider>
);
