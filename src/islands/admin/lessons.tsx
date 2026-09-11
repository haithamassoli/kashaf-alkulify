/**
 * The lesson browser and the review queue. They are one screen: the queue is
 * just the browser filtered to `needs_review` and ordered least-confident first,
 * which is the order the index already returns.
 *
 * A lesson is judged by ear, so the detail panel leads with the player.
 */

import {
  useMutation,
  usePaginatedQuery,
  useQuery_experimental as useQuery,
} from "convex/react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ExternalLink,
  Layers,
  Search,
  Undo2,
  X,
} from "lucide-react";
import { type ChangeEvent, type ReactNode, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { LessonPlayer } from "./player";
import {
  Banner,
  bytes,
  Chip,
  DANGER,
  duration,
  Empty,
  errorMessage,
  FIELD,
  ICON_BUTTON,
  num,
  PRIMARY,
  SECONDARY,
  Spinner,
  type Tone,
} from "./ui";

type ReviewStatus = "auto" | "needs_review" | "approved";

interface Summary {
  durationMs: number;
  groupingConfidence: number;
  id: Id<"lessons">;
  lessonKey: string;
  partCount: number;
  rawTitle: string;
  reviewStatus: ReviewStatus;
  seriesName: string | null;
}

/**
 * A lesson the grouper found no title message for stores `rawTitle: ""`. Those
 * are exactly the rows at the top of the review queue, so they need a label of
 * their own rather than a blank line.
 */
const titleOf = (rawTitle: string): string =>
  rawTitle.trim().length > 0 ? rawTitle : "«بلا عنوان»";

interface Part {
  durationMs: number;
  ext: string;
  partId: Id<"lessonParts">;
  sha256: string;
  sizeBytes: number;
}

const STATUS_TONE: Record<ReviewStatus, Tone> = {
  approved: "accent",
  auto: "muted",
  needs_review: "warn",
};

const STATUS_LABEL: Record<ReviewStatus, string> = {
  approved: "معتمد",
  auto: "آلي",
  needs_review: "يحتاج مراجعة",
};

const FILTERS: { label: string; value: ReviewStatus | null }[] = [
  { label: "طابور المراجعة", value: "needs_review" },
  { label: "آلي", value: "auto" },
  { label: "معتمد", value: "approved" },
  { label: "الكل", value: null },
];

const PAGE_SIZE = 25;
/** Below this, the grouper was guessing — worth surfacing in the row. */
const LOW_CONFIDENCE = 0.6;

const Confidence = ({ value }: { value: number }): ReactNode => (
  <Chip tone={value < LOW_CONFIDENCE ? "warn" : "muted"}>
    <span className="digits">{Math.round(value * 100)}%</span>
  </Chip>
);

const PartRow = ({
  index,
  disabled,
  last,
  onMove,
  part,
}: {
  disabled: boolean;
  index: number;
  last: boolean;
  onMove: (index: number, delta: number) => void;
  part: Part;
}): ReactNode => {
  const handleUp = () => onMove(index, -1);
  const handleDown = () => onMove(index, 1);

  return (
    <li className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
      <span className="digits w-6 shrink-0 text-muted text-xs">
        {num(index + 1)}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted text-xs" dir="ltr">
        {part.sha256.slice(0, 12)}.{part.ext}
      </span>
      <span className="digits shrink-0 text-xs">
        {duration(part.durationMs)}
      </span>
      <span className="digits shrink-0 text-muted text-xs">
        {bytes(part.sizeBytes)}
      </span>
      <button
        aria-label="تحريك لأعلى"
        className={ICON_BUTTON}
        disabled={disabled || index === 0}
        onClick={handleUp}
        type="button"
      >
        <ArrowUp aria-hidden="true" className="size-4" />
      </button>
      <button
        aria-label="تحريك لأسفل"
        className={ICON_BUTTON}
        disabled={disabled || last}
        onClick={handleDown}
        type="button"
      >
        <ArrowDown aria-hidden="true" className="size-4" />
      </button>
    </li>
  );
};

const Detail = ({
  id,
  onClose,
}: {
  id: Id<"lessons">;
  onClose: () => void;
}): ReactNode => {
  const state = useQuery({ args: { id }, query: api.admin.lesson });
  const setReviewStatus = useMutation(api.admin.setReviewStatus);
  const reorderParts = useMutation(api.admin.reorderParts);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lesson = state.status === "success" ? state.data : null;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);

    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = () => {
    if (lesson) {
      run(() => setReviewStatus({ id: lesson.id, reviewStatus: "approved" }));
    }
  };

  const handleQueue = () => {
    if (lesson) {
      run(() =>
        setReviewStatus({ id: lesson.id, reviewStatus: "needs_review" })
      );
    }
  };

  const handleMove = (index: number, delta: number) => {
    if (!lesson) {
      return;
    }

    const order = lesson.parts.map((part) => part.partId);
    const target = index + delta;
    const current = order[index];
    const swapped = order[target];

    if (!(current && swapped)) {
      return;
    }

    order[index] = swapped;
    order[target] = current;
    run(() => reorderParts({ id: lesson.id, partIds: order }));
  };

  if (state.status === "pending") {
    return <Spinner label="جارٍ تحميل الدرس…" />;
  }

  if (lesson === null) {
    return <Empty>تعذّر تحميل هذا الدرس.</Empty>;
  }

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-lg leading-8">
            {titleOf(lesson.rawTitle)}
          </h2>
          <p className="mt-1 truncate text-muted text-xs" dir="ltr">
            {lesson.lessonKey}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-muted text-xs">
            <Chip tone={STATUS_TONE[lesson.reviewStatus]}>
              {STATUS_LABEL[lesson.reviewStatus]}
            </Chip>
            {lesson.seriesName && (
              <span>
                {lesson.seriesName}
                {lesson.seriesEpisode !== null && (
                  <>
                    {" · "}
                    <span className="digits">{num(lesson.seriesEpisode)}</span>
                  </>
                )}
              </span>
            )}
            <span className="digits">{duration(lesson.durationMs)}</span>
            <span>
              أجزاء: <span className="digits">{num(lesson.partCount)}</span>
            </span>
          </p>
        </div>
        <button
          aria-label="إغلاق"
          className={ICON_BUTTON}
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>

      <div className="mt-4">
        <LessonPlayer
          lessonId={lesson.id}
          title={titleOf(lesson.rawTitle)}
          totalMs={lesson.durationMs}
        />
      </div>

      {error && <Banner>{error}</Banner>}

      <div className="mt-4 flex flex-wrap gap-2">
        {lesson.reviewStatus === "approved" ? (
          <button
            className={DANGER}
            disabled={busy}
            onClick={handleQueue}
            type="button"
          >
            <Undo2 aria-hidden="true" className="size-4" />
            سحب الاعتماد
          </button>
        ) : (
          <button
            className={PRIMARY}
            disabled={busy}
            onClick={handleApprove}
            type="button"
          >
            <Check aria-hidden="true" className="size-4" />
            اعتماد الدرس
          </button>
        )}
        {lesson.reviewStatus === "auto" && (
          <button
            className={SECONDARY}
            disabled={busy}
            onClick={handleQueue}
            type="button"
          >
            إرسال إلى الطابور
          </button>
        )}
      </div>

      <h3 className="mt-6 flex items-center gap-2 font-medium text-sm">
        <Layers aria-hidden="true" className="size-4 text-muted" />
        الأجزاء بالترتيب
      </h3>
      <ol className="mt-3 space-y-2">
        {lesson.parts.map((part, index) => (
          <PartRow
            disabled={busy}
            index={index}
            key={part.partId}
            last={index === lesson.parts.length - 1}
            onMove={handleMove}
            part={part}
          />
        ))}
      </ol>

      {lesson.sources.length > 0 && (
        <>
          <h3 className="mt-6 font-medium text-sm">المصادر</h3>
          <ul className="mt-3 space-y-1">
            {lesson.sources.map((source) => (
              <li key={source.id}>
                <a
                  className="inline-flex items-center gap-2 text-accent text-sm underline underline-offset-4"
                  href={source.url}
                  rel="noopener"
                  target="_blank"
                >
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                  <span dir="ltr">{source.url}</span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};

const FilterButton = ({
  current,
  label,
  onSelect,
  value,
}: {
  current: ReviewStatus | null;
  label: string;
  onSelect: (value: ReviewStatus | null) => void;
  value: ReviewStatus | null;
}): ReactNode => {
  const active = current === value;
  const handleClick = () => onSelect(value);

  return (
    <button
      aria-pressed={active}
      className={`min-h-9 rounded-lg px-3 text-sm transition-colors ${
        active
          ? "bg-accent text-accent-fg"
          : "border border-border text-muted hover:bg-surface-2"
      }`}
      onClick={handleClick}
      type="button"
    >
      {label}
    </button>
  );
};

const LessonRow = ({
  lesson,
  onSelect,
  selected,
}: {
  lesson: Summary;
  onSelect: (id: Id<"lessons">) => void;
  selected: boolean;
}): ReactNode => {
  const handleClick = () => onSelect(lesson.id);

  return (
    <li>
      <button
        aria-current={selected}
        className={`w-full rounded-xl border p-3 text-start transition-colors ${
          selected
            ? "border-accent bg-accent-soft"
            : "border-border hover:bg-surface-2"
        }`}
        onClick={handleClick}
        type="button"
      >
        <p
          className={`font-medium text-sm leading-7 ${
            lesson.rawTitle.trim().length > 0 ? "" : "text-muted italic"
          }`}
        >
          {titleOf(lesson.rawTitle)}
        </p>
        <p className="mt-0.5 truncate text-muted text-xs" dir="ltr">
          {lesson.lessonKey}
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-muted text-xs">
          <Chip tone={STATUS_TONE[lesson.reviewStatus]}>
            {STATUS_LABEL[lesson.reviewStatus]}
          </Chip>
          <Confidence value={lesson.groupingConfidence} />
          <span className="digits">{duration(lesson.durationMs)}</span>
          <span>
            أجزاء: <span className="digits">{num(lesson.partCount)}</span>
          </span>
          {lesson.seriesName && <span>{lesson.seriesName}</span>}
        </p>
      </button>
    </li>
  );
};

export const Lessons = (): ReactNode => {
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus | null>(
    "needs_review"
  );
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Id<"lessons"> | null>(null);

  const { isLoading, loadMore, results, status } = usePaginatedQuery(
    api.admin.lessons,
    { reviewStatus, search },
    { initialNumItems: PAGE_SIZE }
  );

  const handleSearch = (event: ChangeEvent<HTMLInputElement>) =>
    setSearch(event.target.value);
  const handleMore = () => loadMore(PAGE_SIZE);
  const handleClose = () => setSelected(null);

  return (
    <div className="grid gap-6 pb-8 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted"
          />
          <input
            aria-label="ابحث في عناوين الدروس"
            className={`${FIELD} ps-10`}
            onChange={handleSearch}
            placeholder="ابحث في عناوين الدروس…"
            type="search"
            value={search}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <FilterButton
              current={reviewStatus}
              key={filter.label}
              label={filter.label}
              onSelect={setReviewStatus}
              value={filter.value}
            />
          ))}
        </div>

        {status === "LoadingFirstPage" && <Spinner label="جارٍ التحميل…" />}

        {status !== "LoadingFirstPage" && results.length === 0 && (
          <Empty>
            {search.trim().length > 0
              ? "لا نتائج لهذا البحث."
              : "لا دروس في هذا التصنيف."}
          </Empty>
        )}

        <ul className="mt-4 space-y-2">
          {results.map((lesson) => (
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              onSelect={setSelected}
              selected={selected === lesson.id}
            />
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

      <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
        {selected === null ? (
          <Empty>اختر درسًا لسماعه ومراجعته.</Empty>
        ) : (
          <Detail id={selected} key={selected} onClose={handleClose} />
        )}
      </div>
    </div>
  );
};
