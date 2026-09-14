import { ConvexProvider, usePaginatedQuery, useQuery } from "convex/react";
import {
  type ChangeEvent,
  type ReactNode,
  useDeferredValue,
  useState,
} from "react";
import { api } from "../../convex/_generated/api";
import { convex } from "../lib/convex";
import { LoadMore, Skeleton } from "./list-parts";

const PAGE_SIZE = 30;

const number = (value: number) => value.toLocaleString("en-US");

const duration = (milliseconds: number): string => {
  const minutes = Math.round(milliseconds / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) {
    return `${number(rest)} دقيقة`;
  }

  return rest === 0
    ? `${number(hours)} ساعة`
    : `${number(hours)} ساعة و${number(rest)} دقيقة`;
};

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
              href={`/p/?name=${encodeURIComponent(item.name)}`}
            >
              <span className="block font-medium leading-relaxed">
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

const SeriesDetail = ({ name }: { name: string }): ReactNode => {
  const lessons = useQuery(api.content.seriesLessons, { name });

  if (lessons === undefined) {
    return <Skeleton className="mt-24 space-y-2" />;
  }

  return (
    <>
      <a
        className="mt-8 inline-flex min-h-11 items-center text-muted underline underline-offset-4 hover:text-fg"
        href="/p/"
      >
        القوائم
      </a>
      <h1 className="mt-2 font-semibold text-2xl tracking-tight sm:text-3xl">
        {name}
      </h1>
      <p className="mt-2 text-muted text-sm">
        <span className="digits">{number(lessons.length)}</span> درس
      </p>

      {lessons.length === 0 ? (
        <p className="mt-6 text-muted text-sm">لم نجد هذه القائمة.</p>
      ) : (
        <ol className="mt-6 space-y-2">
          {lessons.map((lesson) => (
            <li key={lesson.id}>
              <a
                className="card flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                href={`/v/?id=${lesson.id}`}
              >
                {lesson.episode !== null && (
                  <span className="digits mt-0.5 shrink-0 rounded-md bg-surface-2 px-2 py-1 text-muted text-xs">
                    {number(lesson.episode)}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-medium leading-relaxed">
                    {lesson.title || "درس بلا عنوان"}
                  </span>
                  <span className="mt-1 block text-muted text-sm">
                    {duration(lesson.durationMs)}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </>
  );
};

const PlaylistsContent = (): ReactNode => {
  const name = new URLSearchParams(window.location.search).get("name")?.trim();

  return name ? <SeriesDetail name={name} /> : <SeriesList />;
};

export const Playlists = (): ReactNode => (
  <ConvexProvider client={convex}>
    <PlaylistsContent />
  </ConvexProvider>
);
