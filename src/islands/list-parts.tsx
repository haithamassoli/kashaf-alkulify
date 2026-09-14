import type { ReactNode } from "react";

const ROWS = [0, 1, 2, 3, 4, 5];

/** Placeholder cards shown while a Convex subscription has not delivered yet. */
export const Skeleton = ({
  className = "mt-4 space-y-2",
  rows = ROWS.length,
}: {
  className?: string;
  rows?: number;
}): ReactNode => (
  <>
    <p aria-live="polite" className="sr-only">
      جارٍ التحميل…
    </p>
    <ul aria-hidden="true" className={className}>
      {ROWS.slice(0, rows).map((row) => (
        <li className="card animate-pulse px-4 py-4" key={row}>
          <div className="h-4 w-2/5 rounded bg-surface-2" />
          <div className="mt-3 h-3 w-1/4 rounded bg-surface-2" />
          <div className="mt-3 h-3 w-4/5 rounded bg-surface-2" />
        </li>
      ))}
    </ul>
  </>
);

export const LoadMore = ({
  onMore,
  status,
}: {
  onMore: () => void;
  status: string;
}): ReactNode => {
  if (status === "LoadingMore") {
    return <Skeleton rows={2} />;
  }

  if (status !== "CanLoadMore") {
    return null;
  }

  return (
    <button
      className="mt-4 min-h-11 w-full rounded-lg border border-border bg-surface px-4 text-sm transition-colors hover:bg-surface-2"
      onClick={onMore}
      type="button"
    >
      تحميل المزيد
    </button>
  );
};
