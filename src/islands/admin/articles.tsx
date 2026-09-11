/** The article browser: 4,455 extracted posts, newest first, searchable. */

import { usePaginatedQuery } from "convex/react";
import { ExternalLink, Search } from "lucide-react";
import { type ChangeEvent, type ReactNode, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Empty, FIELD, SECONDARY, Spinner, stamp } from "./ui";

const PAGE_SIZE = 20;

export const Articles = (): ReactNode => {
  const [search, setSearch] = useState("");
  const { isLoading, loadMore, results, status } = usePaginatedQuery(
    api.admin.articles,
    { search },
    { initialNumItems: PAGE_SIZE }
  );

  const handleSearch = (event: ChangeEvent<HTMLInputElement>) =>
    setSearch(event.target.value);

  const handleMore = () => loadMore(PAGE_SIZE);

  return (
    <div className="pb-8">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted"
        />
        <input
          aria-label="ابحث في عناوين المقالات"
          className={`${FIELD} ps-10`}
          onChange={handleSearch}
          placeholder="ابحث في عناوين المقالات…"
          type="search"
          value={search}
        />
      </div>

      {status === "LoadingFirstPage" && <Spinner label="جارٍ التحميل…" />}

      {status !== "LoadingFirstPage" && results.length === 0 && (
        <Empty>لا نتائج لهذا البحث.</Empty>
      )}

      <ul className="mt-4 space-y-3">
        {results.map((article) => (
          <li className="card p-4" key={article.id}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-medium leading-7">{article.title}</h2>
              <a
                aria-label="فتح في تيليجرام"
                className="shrink-0 text-muted transition-colors hover:text-accent"
                href={article.telegramUrl}
                rel="noopener"
                target="_blank"
              >
                <ExternalLink aria-hidden="true" className="size-4" />
              </a>
            </div>
            <p className="mt-2 line-clamp-3 text-muted text-sm leading-7">
              {article.preview}
            </p>
            <p className="digits mt-2 text-muted text-xs">
              {stamp(article.date)}
            </p>
          </li>
        ))}
      </ul>

      {status === "CanLoadMore" && (
        <button
          className={`${SECONDARY} mt-4 w-full`}
          onClick={handleMore}
          type="button"
        >
          تحميل المزيد
        </button>
      )}
      {isLoading && status !== "LoadingFirstPage" && (
        <Spinner label="جارٍ التحميل…" />
      )}
    </div>
  );
};
