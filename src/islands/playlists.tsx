import { ConvexProvider, usePaginatedQuery } from "convex/react";
import {
  type ChangeEvent,
  type ReactNode,
  useDeferredValue,
  useState,
} from "react";
import { api } from "../../convex/_generated/api";
import { convex } from "../lib/convex";
import { duration } from "../lib/format";
import { seriesPath } from "../lib/paths";
import { LoadMore, Skeleton } from "./list-parts";

const PAGE_SIZE = 30;

const number = (value: number) => value.toLocaleString("en-US");

const SeriesList = (): ReactNode => {
  const [filter, setFilter] = useState("");
  const search = useDeferredValue(filter.trim());
  const {
    loadMore,
    results: rows,
    status,
  } = usePaginatedQuery(
    api.content.series,
    { search },
    { initialNumItems: PAGE_SIZE }
  );
  const handleFilter = (event: ChangeEvent<HTMLInputElement>) =>
    setFilter(event.target.value);
  const handleMore = () => loadMore(PAGE_SIZE);

  return (
    <>
      <h1 className="mt-10 font-semibold text-2xl tracking-tight sm:text-3xl">
        القوائم
      </h1>
      <p className="mt-3 text-muted">تصفّح الدروس مرتبةً حسب السلسلة.</p>
      <label className="sr-only" htmlFor="playlist-filter">
        ابحث في القوائم
      </label>
      <input
        autoComplete="off"
        className="mt-6 w-full rounded-xl border border-border-strong bg-surface px-4 py-3 text-base placeholder:text-muted"
        data-search-input
        id="playlist-filter"
        onChange={handleFilter}
        placeholder="ابحث في القوائم"
        type="search"
        value={filter}
      />

      {status === "LoadingFirstPage" && <Skeleton />}
      {status !== "LoadingFirstPage" && rows.length === 0 && (
        <p className="mt-6 text-muted text-sm">لا نتائج.</p>
      )}
      <ul className="mt-4 space-y-2">
        {rows.map((item) => (
          <li key={item.name}>
            <a
              className="card block px-4 py-4 transition-colors hover:bg-surface-2"
              href={seriesPath(item.name)}
            >
              <span className="block font-medium leading-relaxed" data-vt-title>
                {item.name}
              </span>
              <span className="mt-1 block text-muted text-sm">
                <span className="digits">{number(item.count)}</span> درس ·{" "}
                {duration(item.durationMs)}
              </span>
            </a>
          </li>
        ))}
      </ul>

      <LoadMore onMore={handleMore} status={status} />
    </>
  );
};

export const Playlists = (): ReactNode => (
  <ConvexProvider client={convex}>
    <SeriesList />
  </ConvexProvider>
);
