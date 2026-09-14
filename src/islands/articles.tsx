import { ConvexProvider, usePaginatedQuery, useQuery } from "convex/react";
import {
  type ChangeEvent,
  type ReactNode,
  useDeferredValue,
  useState,
} from "react";
import { api } from "../../convex/_generated/api";
import { convex } from "../lib/convex";
import { Actions } from "./actions";

const PAGE_SIZE = 30;
const DATE = new Intl.DateTimeFormat("ar-u-nu-latn", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const date = (milliseconds: number) => DATE.format(new Date(milliseconds));

const ArticleList = (): ReactNode => {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const { loadMore, results, status } = usePaginatedQuery(
    api.content.articles,
    { search: deferredSearch },
    { initialNumItems: PAGE_SIZE }
  );
  const handleSearch = (event: ChangeEvent<HTMLInputElement>) =>
    setSearch(event.target.value);
  const handleMore = () => loadMore(PAGE_SIZE);

  return (
    <>
      <h1 className="mt-10 font-semibold text-2xl tracking-tight sm:text-3xl">
        المقالات
      </h1>
      <p className="mt-3 text-muted">تصفّح المقالات أو ابحث في عناوينها.</p>
      <label className="sr-only" htmlFor="article-filter">
        ابحث في المقالات
      </label>
      <input
        autoComplete="off"
        className="mt-6 w-full rounded-xl border border-border-strong bg-surface px-4 py-3 text-base placeholder:text-muted"
        data-search-input
        id="article-filter"
        onChange={handleSearch}
        placeholder="ابحث في عناوين المقالات"
        type="search"
        value={search}
      />

      {status === "LoadingFirstPage" && (
        <p aria-live="polite" className="mt-6 text-muted text-sm">
          جارٍ تحميل المقالات…
        </p>
      )}

      {status !== "LoadingFirstPage" && results.length === 0 && (
        <p className="mt-6 text-muted text-sm">لا نتائج.</p>
      )}

      <ul className="mt-4 space-y-2">
        {results.map((article) => (
          <li key={article.id}>
            <a
              className="card block px-4 py-3 transition-colors hover:bg-surface-2"
              href={`/a/?id=${article.id}`}
            >
              <span className="block font-medium leading-relaxed">
                {article.title}
              </span>
              <span className="mt-1 block text-muted text-sm">
                <bdi>{date(article.date)}</bdi>
              </span>
              <span className="mt-2 line-clamp-2 block text-muted text-sm leading-7">
                {article.preview}
              </span>
            </a>
          </li>
        ))}
      </ul>

      {status === "CanLoadMore" && (
        <button
          className="mt-4 min-h-11 w-full rounded-lg border border-border bg-surface px-4 text-sm transition-colors hover:bg-surface-2"
          onClick={handleMore}
          type="button"
        >
          تحميل المزيد
        </button>
      )}
      {status === "LoadingMore" && (
        <p aria-live="polite" className="mt-4 text-center text-muted text-sm">
          جارٍ التحميل…
        </p>
      )}
    </>
  );
};

const ArticleDetail = ({ id }: { id: string }): ReactNode => {
  const article = useQuery(api.content.article, { id });

  if (article === undefined) {
    return (
      <p aria-live="polite" className="mt-8 text-muted text-sm">
        جارٍ تحميل المقالة…
      </p>
    );
  }

  if (article === null) {
    return (
      <div className="pt-8">
        <a
          className="inline-flex min-h-11 items-center text-muted underline underline-offset-4 hover:text-fg"
          href="/a/"
        >
          المقالات
        </a>
        <p className="mt-4 text-muted">لم نجد هذه المقالة.</p>
      </div>
    );
  }

  return (
    <article className="pt-8">
      <a
        className="inline-flex min-h-11 items-center text-muted underline underline-offset-4 hover:text-fg"
        href="/a/"
      >
        المقالات
      </a>
      <span className="mt-3 block w-fit rounded-full bg-surface-2 px-3 py-1 text-muted text-xs">
        مقالة
      </span>
      <h1 className="mt-4 font-semibold text-xl leading-relaxed sm:text-2xl">
        {article.title}
      </h1>
      <div className="mt-1 flex flex-wrap items-center gap-x-5 text-muted text-sm">
        <bdi>{date(article.date)}</bdi>
        <a
          className="inline-flex min-h-11 items-center text-accent underline underline-offset-4"
          href={article.telegramUrl}
          rel="noopener"
          target="_blank"
        >
          المصدر
        </a>
      </div>
      <Actions
        body={article.text}
        href={`/a/?id=${encodeURIComponent(id)}`}
        kind="a"
        title={article.title}
      />
      <div className="prose-read mt-6 max-w-none whitespace-pre-wrap text-fg">
        {article.text}
      </div>
    </article>
  );
};

const ArticlesContent = (): ReactNode => {
  const id = new URLSearchParams(window.location.search).get("id")?.trim();

  return id ? <ArticleDetail id={id} /> : <ArticleList />;
};

export const Articles = (): ReactNode => (
  <ConvexProvider client={convex}>
    <ArticlesContent />
  </ConvexProvider>
);
