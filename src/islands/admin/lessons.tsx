/**
 * The lesson browser and the review queue. They are one screen: the queue is
 * just the browser filtered to `needs_review` and ordered least-confident first,
 * which is the order the index already returns.
 *
 * A lesson is judged by ear, so the detail panel leads with the player. Below it
 * are the four repairs a human can make that the grouper cannot: rename the
 * lesson, reorder its parts, carry a part over to the lesson it belongs to, and
 * throw away what should never have been archived. Each of those outranks the
 * pipeline permanently — see `partsLocked` / `titleLocked` / `deletedAt` in the
 * schema — so every one of them is behind a confirmation and says what it locks.
 */

import {
  useAction,
  useMutation,
  usePaginatedQuery,
  useQuery_experimental as useQuery,
} from "convex/react";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Check,
  ExternalLink,
  Layers,
  Lock,
  Pencil,
  Search,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useState,
} from "react";
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
  partsLocked: boolean;
  rawTitle: string;
  reviewStatus: ReviewStatus;
  seriesEpisode: number | null;
  seriesName: string | null;
  titleLocked: boolean;
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
  shared: boolean;
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
/** How many candidate lessons the "move a part" picker offers at a time. */
const PICKER_SIZE = 8;
/** Below this, the grouper was guessing — worth surfacing in the row. */
const LOW_CONFIDENCE = 0.6;

const Confidence = ({ value }: { value: number }): ReactNode => (
  <Chip tone={value < LOW_CONFIDENCE ? "warn" : "muted"}>
    <span className="digits">{Math.round(value * 100)}%</span>
  </Chip>
);

/**
 * Shown on any lesson a human has edited. It is not decoration: the pipeline
 * stops overwriting what it marks, so an operator wondering why a rerun did not
 * fix a lesson should be able to see the reason on the lesson itself.
 */
const LockChip = ({
  partsLocked,
  titleLocked,
}: {
  partsLocked: boolean;
  titleLocked: boolean;
}): ReactNode => {
  if (!(partsLocked || titleLocked)) {
    return null;
  }

  const what = [titleLocked ? "العنوان" : null, partsLocked ? "الأجزاء" : null]
    .filter((label) => label !== null)
    .join(" و");

  return (
    <Chip tone="accent">
      <Lock aria-hidden="true" className="size-3" />
      {`تعديل يدوي · ${what}`}
    </Chip>
  );
};

// ── moving a part ────────────────────────────────────────────────────────────

const MoveOption = ({
  busy,
  lesson,
  onPick,
}: {
  busy: boolean;
  lesson: Summary;
  onPick: (id: Id<"lessons">) => void;
}): ReactNode => {
  const handleClick = () => onPick(lesson.id);

  return (
    <li>
      <button
        className="w-full rounded-lg border border-border bg-surface p-2.5 text-start text-sm transition-colors hover:bg-surface-2 disabled:opacity-50"
        disabled={busy}
        onClick={handleClick}
        type="button"
      >
        <span className="block truncate">{titleOf(lesson.rawTitle)}</span>
        <span className="mt-0.5 block text-muted text-xs">
          <span className="digits">{num(lesson.partCount)}</span> جزء ·{" "}
          <span className="digits">{duration(lesson.durationMs)}</span>
        </span>
      </button>
    </li>
  );
};

/**
 * Picks the lesson a part is carried over to. Its own search rather than a drop
 * of every lesson: the archive has thousands, and the lesson a stray part
 * belongs to is always one whose title the operator can already half remember.
 */
const MovePicker = ({
  busy,
  exclude,
  onCancel,
  onPick,
}: {
  busy: boolean;
  exclude: Id<"lessons">;
  onCancel: () => void;
  onPick: (id: Id<"lessons">) => void;
}): ReactNode => {
  const [search, setSearch] = useState("");
  const { results, status } = usePaginatedQuery(
    api.admin.lessons,
    { reviewStatus: null, search },
    { initialNumItems: PICKER_SIZE }
  );

  const handleSearch = (event: ChangeEvent<HTMLInputElement>) =>
    setSearch(event.target.value);

  const options = results.filter((lesson) => lesson.id !== exclude);

  return (
    <div className="mt-2 rounded-lg border border-accent bg-accent-soft/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-sm">انقل هذا المقطع إلى درس آخر</p>
        <button
          className={SECONDARY}
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          إلغاء
        </button>
      </div>

      <input
        aria-label="ابحث عن الدرس الهدف"
        className={`${FIELD} mt-3`}
        onChange={handleSearch}
        placeholder="ابحث بعنوان الدرس…"
        type="search"
        value={search}
      />

      {status === "LoadingFirstPage" && <Spinner label="جارٍ البحث…" />}

      {status !== "LoadingFirstPage" && options.length === 0 && (
        <p className="mt-3 text-muted text-sm">لا دروس مطابقة.</p>
      )}

      <ul className="mt-3 space-y-1">
        {options.slice(0, PICKER_SIZE).map((lesson) => (
          <MoveOption
            busy={busy}
            key={lesson.id}
            lesson={lesson}
            onPick={onPick}
          />
        ))}
      </ul>
    </div>
  );
};

// ── one part ─────────────────────────────────────────────────────────────────

type PartMode = { id: Id<"lessonParts">; mode: "delete" | "move" } | null;

interface PartHandlers {
  onDelete: (part: Part) => void;
  onMove: (index: number, delta: number) => void;
  onMoveTo: (partId: Id<"lessonParts">, lessonId: Id<"lessons">) => void;
}

const PartConfirm = ({
  busy,
  onCancel,
  onConfirm,
  part,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  part: Part;
}): ReactNode => (
  <div className="mt-2 rounded-lg border border-destructive p-3">
    <p className="text-sm leading-7">
      {part.shared
        ? "يُحذف هذا الجزء من الدرس فقط؛ الملف الصوتي مستخدم في درس آخر فيبقى في التخزين."
        : `يُحذف هذا الجزء والملف الصوتي (${bytes(part.sizeBytes)}) نهائيًا من التخزين. لا يمكن التراجع.`}
    </p>
    <p className="mt-1 text-muted text-xs leading-6">
      لن يعيده خط المعالجة عند تنزيل محتوى جديد من القناة.
    </p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button
        className={DANGER}
        disabled={busy}
        onClick={onConfirm}
        type="button"
      >
        <Trash2 aria-hidden="true" className="size-4" />
        تأكيد الحذف
      </button>
      <button
        className={SECONDARY}
        disabled={busy}
        onClick={onCancel}
        type="button"
      >
        إلغاء
      </button>
    </div>
  </div>
);

const PartRow = ({
  busy,
  handlers,
  index,
  last,
  lessonId,
  onMode,
  part,
  partMode,
}: {
  busy: boolean;
  handlers: PartHandlers;
  index: number;
  last: boolean;
  lessonId: Id<"lessons">;
  onMode: (next: PartMode) => void;
  part: Part;
  partMode: PartMode;
}): ReactNode => {
  const mode = partMode?.id === part.partId ? partMode.mode : null;
  const handleUp = () => handlers.onMove(index, -1);
  const handleDown = () => handlers.onMove(index, 1);
  const handleMoveMode = () =>
    onMode(mode === "move" ? null : { id: part.partId, mode: "move" });
  const handleDeleteMode = () =>
    onMode(mode === "delete" ? null : { id: part.partId, mode: "delete" });
  const handleCancel = () => onMode(null);
  const handleDelete = () => handlers.onDelete(part);
  const handlePick = (target: Id<"lessons">) =>
    handlers.onMoveTo(part.partId, target);

  return (
    <li className="rounded-lg border border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
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
          disabled={busy || index === 0}
          onClick={handleUp}
          title="تحريك لأعلى"
          type="button"
        >
          <ArrowUp aria-hidden="true" className="size-4" />
        </button>
        <button
          aria-label="تحريك لأسفل"
          className={ICON_BUTTON}
          disabled={busy || last}
          onClick={handleDown}
          title="تحريك لأسفل"
          type="button"
        >
          <ArrowDown aria-hidden="true" className="size-4" />
        </button>
        <button
          aria-label="نقل إلى درس آخر"
          aria-pressed={mode === "move"}
          className={ICON_BUTTON}
          disabled={busy}
          onClick={handleMoveMode}
          title="نقل إلى درس آخر"
          type="button"
        >
          <ArrowLeftRight aria-hidden="true" className="size-4" />
        </button>
        <button
          aria-label="حذف المقطع"
          aria-pressed={mode === "delete"}
          className={`${ICON_BUTTON} hover:text-destructive`}
          disabled={busy}
          onClick={handleDeleteMode}
          title="حذف المقطع"
          type="button"
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </button>
      </div>

      {mode === "move" && (
        <MovePicker
          busy={busy}
          exclude={lessonId}
          onCancel={handleCancel}
          onPick={handlePick}
        />
      )}
      {mode === "delete" && (
        <PartConfirm
          busy={busy}
          onCancel={handleCancel}
          onConfirm={handleDelete}
          part={part}
        />
      )}
    </li>
  );
};

// ── renaming ─────────────────────────────────────────────────────────────────

interface TitleValues {
  rawTitle: string;
  seriesEpisode: number | null;
  seriesName: string | null;
}

const TitleForm = ({
  busy,
  lesson,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  lesson: Summary;
  onCancel: () => void;
  onSubmit: (values: TitleValues) => void;
}): ReactNode => {
  const [rawTitle, setRawTitle] = useState(lesson.rawTitle);
  const [seriesName, setSeriesName] = useState(lesson.seriesName ?? "");
  const [episode, setEpisode] = useState(
    lesson.seriesEpisode === null ? "" : String(lesson.seriesEpisode)
  );

  const handleTitle = (event: ChangeEvent<HTMLInputElement>) =>
    setRawTitle(event.target.value);
  const handleSeries = (event: ChangeEvent<HTMLInputElement>) =>
    setSeriesName(event.target.value);
  const handleEpisode = (event: ChangeEvent<HTMLInputElement>) =>
    setEpisode(event.target.value);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const parsed = Number.parseInt(episode, 10);

    onSubmit({
      rawTitle,
      seriesEpisode: Number.isFinite(parsed) ? parsed : null,
      seriesName: seriesName.trim().length > 0 ? seriesName : null,
    });
  };

  return (
    <form
      className="rounded-xl border border-border p-4"
      onSubmit={handleSubmit}
    >
      <div>
        <label className="block font-medium text-sm" htmlFor="lesson-title">
          عنوان الدرس
        </label>
        <input
          autoFocus
          className={`${FIELD} mt-2`}
          id="lesson-title"
          onChange={handleTitle}
          placeholder="مثال: شرح عمدة الفقه (12)"
          value={rawTitle}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <div>
          <label className="block font-medium text-sm" htmlFor="lesson-series">
            السلسلة
          </label>
          <input
            className={`${FIELD} mt-2`}
            id="lesson-series"
            onChange={handleSeries}
            placeholder="اتركه فارغًا إن لم يكن ضمن سلسلة"
            value={seriesName}
          />
        </div>
        <div>
          <label className="block font-medium text-sm" htmlFor="lesson-episode">
            رقم الحلقة
          </label>
          <input
            className={`${FIELD} mt-2`}
            dir="ltr"
            id="lesson-episode"
            inputMode="numeric"
            onChange={handleEpisode}
            value={episode}
          />
        </div>
      </div>

      <p className="mt-3 text-muted text-xs leading-6">
        العنوان المكتوب هنا يبقى كما هو، ولن يستبدله خط المعالجة في تشغيله
        القادم.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className={PRIMARY} disabled={busy} type="submit">
          <Check aria-hidden="true" className="size-4" />
          حفظ العنوان
        </button>
        <button
          className={SECONDARY}
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          إلغاء
        </button>
      </div>
    </form>
  );
};

// ── deleting a lesson ────────────────────────────────────────────────────────

const LessonConfirm = ({
  busy,
  onCancel,
  onConfirm,
  parts,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  parts: Part[];
}): ReactNode => {
  const doomed = parts.filter((part) => !part.shared);
  const size = doomed.reduce((total, part) => total + part.sizeBytes, 0);
  const kept = parts.length - doomed.length;

  return (
    <div className="mt-4 rounded-xl border border-destructive p-4">
      <p className="font-medium text-sm leading-7">
        يُحذف هذا الدرس مع <span className="digits">{num(doomed.length)}</span>{" "}
        ملفًا صوتيًا ({bytes(size)}) نهائيًا من التخزين. لا يمكن التراجع.
      </p>
      {kept > 0 && (
        <p className="mt-1 text-muted text-sm leading-7">
          <span className="digits">{num(kept)}</span> ملفًا مستخدم في دروس أخرى
          فيبقى في التخزين.
        </p>
      )}
      <p className="mt-1 text-muted text-xs leading-6">
        لن يعيده خط المعالجة عند تنزيل محتوى جديد من القناة.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className={DANGER}
          disabled={busy}
          onClick={onConfirm}
          type="button"
        >
          <Trash2 aria-hidden="true" className="size-4" />
          تأكيد حذف الدرس
        </button>
        <button
          className={SECONDARY}
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
};

// ── the detail panel ─────────────────────────────────────────────────────────

const Detail = ({
  id,
  onClose,
}: {
  id: Id<"lessons">;
  onClose: () => void;
}): ReactNode => {
  const state = useQuery({ args: { id }, query: api.admin.lesson });
  const setReviewStatus = useMutation(api.admin.setReviewStatus);
  const setLessonTitle = useMutation(api.admin.setLessonTitle);
  const reorderParts = useMutation(api.admin.reorderParts);
  const movePart = useMutation(api.admin.movePart);
  const purge = useAction(api.media.purge);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingLesson, setConfirmingLesson] = useState(false);
  const [partMode, setPartMode] = useState<PartMode>(null);

  const lesson = state.status === "success" ? state.data : null;

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);

    try {
      await action();
      after?.();
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

  const handleMoveTo = (
    partId: Id<"lessonParts">,
    toLessonId: Id<"lessons">
  ) => {
    // The last part leaving takes the lesson with it, so the panel closes.
    const emptied = lesson?.parts.length === 1;

    run(
      () => movePart({ partId, toLessonId }),
      () => {
        setPartMode(null);

        if (emptied) {
          onClose();
        }
      }
    );
  };

  const handleDeletePart = (part: Part) => {
    const emptied = lesson?.parts.length === 1;

    run(
      () => purge({ target: { id: part.partId, kind: "part" } }),
      () => {
        setPartMode(null);

        if (emptied) {
          onClose();
        }
      }
    );
  };

  const handleDeleteLesson = () => {
    if (lesson) {
      run(() => purge({ target: { id: lesson.id, kind: "lesson" } }), onClose);
    }
  };

  const handleTitle = (values: TitleValues) => {
    if (lesson) {
      run(
        () => setLessonTitle({ id: lesson.id, ...values }),
        () => setEditing(false)
      );
    }
  };

  const handleEdit = () => {
    setConfirmingLesson(false);
    setEditing(true);
  };
  const handleCancelEdit = () => setEditing(false);
  const handleConfirmLesson = () => {
    setEditing(false);
    setConfirmingLesson(true);
  };
  const handleCancelLesson = () => setConfirmingLesson(false);

  const partHandlers: PartHandlers = {
    onDelete: handleDeletePart,
    onMove: handleMove,
    onMoveTo: handleMoveTo,
  };

  if (state.status === "pending") {
    return <Spinner label="جارٍ تحميل الدرس…" />;
  }

  if (lesson === null) {
    return <Empty>حُذف هذا الدرس أو لم يعد متاحًا.</Empty>;
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
            <LockChip
              partsLocked={lesson.partsLocked}
              titleLocked={lesson.titleLocked}
            />
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
        <div className="flex shrink-0 items-center gap-1">
          <button
            aria-label="تعديل العنوان"
            className={ICON_BUTTON}
            disabled={busy}
            onClick={handleEdit}
            title="تعديل العنوان"
            type="button"
          >
            <Pencil aria-hidden="true" className="size-4" />
          </button>
          <button
            aria-label="حذف الدرس"
            className={`${ICON_BUTTON} hover:text-destructive`}
            disabled={busy}
            onClick={handleConfirmLesson}
            title="حذف الدرس"
            type="button"
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </button>
          <button
            aria-label="إغلاق"
            className={ICON_BUTTON}
            onClick={onClose}
            title="إغلاق"
            type="button"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-4">
          <TitleForm
            busy={busy}
            lesson={lesson}
            onCancel={handleCancelEdit}
            onSubmit={handleTitle}
          />
        </div>
      )}

      {confirmingLesson && (
        <LessonConfirm
          busy={busy}
          onCancel={handleCancelLesson}
          onConfirm={handleDeleteLesson}
          parts={lesson.parts}
        />
      )}

      <div className="mt-4">
        {/*
          The player signs one URL per part and holds them in state, so it has
          to be remounted when the composition moves under it. `assemblyHash` is
          exactly that signal — it changes on a reorder, a move or a delete, and
          on nothing else.
        */}
        <LessonPlayer
          key={lesson.assemblyHash}
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
            busy={busy}
            handlers={partHandlers}
            index={index}
            key={part.partId}
            last={index === lesson.parts.length - 1}
            lessonId={lesson.id}
            onMode={setPartMode}
            part={part}
            partMode={partMode}
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

// ── the browser ──────────────────────────────────────────────────────────────

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
          <LockChip
            partsLocked={lesson.partsLocked}
            titleLocked={lesson.titleLocked}
          />
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
