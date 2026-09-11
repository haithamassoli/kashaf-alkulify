/**
 * Unresolved failures across every stage, newest first. The pipeline retries on
 * its own up to five attempts; what is listed here is what it gave up on, plus
 * whatever is still mid-retry.
 */

import { useMutation, usePaginatedQuery } from "convex/react";
import { Check } from "lucide-react";
import { type ReactNode, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
  ago,
  Banner,
  Chip,
  Empty,
  errorMessage,
  num,
  SECONDARY,
  Spinner,
} from "./ui";

const PAGE_SIZE = 20;
/** §4.6: five attempts and the pipeline stops retrying on its own. */
const ATTEMPT_CEILING = 5;

const Row = ({
  failure,
  now,
  onDismiss,
}: {
  failure: Doc<"failures">;
  now: number;
  onDismiss: (id: Id<"failures">) => void;
}): ReactNode => {
  const handleDismiss = () => onDismiss(failure._id);

  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="danger">
            <span dir="ltr">{failure.stage}</span>
          </Chip>
          <Chip tone={failure.attempts >= ATTEMPT_CEILING ? "danger" : "warn"}>
            <span className="digits">{num(failure.attempts)}</span> محاولة
            {failure.attempts >= ATTEMPT_CEILING && " · بلغ السقف"}
          </Chip>
          <span className="text-muted text-xs">
            {ago(failure.lastTriedAt, now)}
          </span>
        </div>
        <button className={SECONDARY} onClick={handleDismiss} type="button">
          <Check aria-hidden="true" className="size-4" />
          اعتبره محلولًا
        </button>
      </div>

      <p className="mt-3 break-all text-muted text-xs" dir="ltr">
        {failure.refKey}
      </p>
      <p
        className="mt-2 rounded-lg bg-surface-2 p-3 text-xs leading-6"
        dir="ltr"
      >
        {failure.error}
      </p>
    </li>
  );
};

export const Failures = (): ReactNode => {
  const now = Date.now();
  const dismiss = useMutation(api.admin.dismissFailure);
  const [error, setError] = useState<string | null>(null);
  const { isLoading, loadMore, results, status } = usePaginatedQuery(
    api.admin.failures,
    {},
    { initialNumItems: PAGE_SIZE }
  );

  const handleMore = () => loadMore(PAGE_SIZE);

  const handleDismiss = async (id: Id<"failures">) => {
    setError(null);

    try {
      await dismiss({ id });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  if (status === "LoadingFirstPage") {
    return <Spinner label="جارٍ التحميل…" />;
  }

  return (
    <div className="pb-8">
      {error && <Banner>{error}</Banner>}

      {results.length === 0 ? (
        <Empty>لا إخفاقات غير محلولة. النظام نظيف.</Empty>
      ) : (
        <ul className="space-y-3">
          {results.map((failure) => (
            <Row
              failure={failure}
              key={failure._id}
              now={now}
              onDismiss={handleDismiss}
            />
          ))}
        </ul>
      )}

      {status === "CanLoadMore" && (
        <button
          className={`${SECONDARY} mt-4 w-full`}
          onClick={handleMore}
          type="button"
        >
          تحميل المزيد
        </button>
      )}
      {isLoading && <Spinner label="جارٍ التحميل…" />}
    </div>
  );
};
