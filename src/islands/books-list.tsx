import { ConvexProvider, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { convex } from "../lib/convex";
import { arabicDate } from "../lib/format";

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

const Books = () => {
  const books = useQuery(api.books.list, {});

  // `undefined` is the loading state: the subscription has not delivered yet.
  if (books === undefined) {
    return (
      <p aria-live="polite" className="mt-6 text-muted text-sm">
        جارٍ التحميل…
      </p>
    );
  }

  if (books.length === 0) {
    return <p className="mt-6 text-muted text-sm">لا توجد كتب بعد.</p>;
  }

  return (
    <ul className="mt-6 grid gap-3 sm:grid-cols-2">
      {books.map((book) => (
        <BookCard book={book} key={book._id} />
      ))}
    </ul>
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
