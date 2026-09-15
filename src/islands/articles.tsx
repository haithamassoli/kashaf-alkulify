import { ConvexProvider, usePaginatedQuery } from "convex/react";
import {
  type ChangeEvent,
  type ReactNode,
  useDeferredValue,
  useState,
} from "react";
import { api } from "../../convex/_generated/api";
import { convex } from "../lib/convex";
import { arabicDay } from "../lib/format";
import { articlePath } from "../lib/paths";
import { LoadMore, Skeleton } from "./list-parts";

const PAGE_SIZE = 30;
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

      {status === "LoadingFirstPage" && <Skeleton />}

      {status !== "LoadingFirstPage" && results.length === 0 && (
        <p className="mt-6 text-muted text-sm">لا نتائج.</p>
      )}

      <ul className="mt-4 space-y-2">
        {results.map((article) => (
          <li key={article.id}>
            <a
              className="card block px-4 py-3 transition-colors hover:bg-surface-2"
              href={articlePath(article.id)}
            >
              <span className="block font-medium leading-relaxed" data-vt-title>
                {article.title}
              </span>
              <span className="mt-1 block text-muted text-sm">
                <bdi>{arabicDay(article.date)}</bdi>
              </span>
              <span className="mt-2 line-clamp-2 block text-muted text-sm leading-7">
                {article.preview}
              </span>
            </a>
          </li>
        ))}
      </ul>

      <LoadMore onMore={handleMore} status={status} />
    </>
  );
};

export const Articles = (): ReactNode => (
  <ConvexProvider client={convex}>
    <ArticleList />
  </ConvexProvider>
);
