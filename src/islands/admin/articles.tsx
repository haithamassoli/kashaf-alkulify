/**
 * The article browser and its repairs. Telegram caps a message at 4,096
 * characters, so one post can land as several articles: the detail panel joins
 * them back, fixes the text, and picks the photos the article shows. Every edit
 * locks what it touched against the next Organizer run — see `textLocked` /
 * `photosLocked` / `deletedAt` in the schema.
 */

import {
  useAction,
  useMutation,
  usePaginatedQuery,
  useQuery_experimental as useQuery,
} from "convex/react";
import {
  Combine,
  ExternalLink,
  ImageOff,
  Lock,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Banner,
  Chip,
  DANGER,
  Empty,
  errorMessage,
  FIELD,
  ICON_BUTTON,
  PRIMARY,
  SECONDARY,
  Spinner,
  stamp,
} from "./ui";

const PAGE_SIZE = 20;
const PICKER_SIZE = 8;

type ArticleId = Id<"articles">;
type PhotoId = Id<"mediaObjects">;

/** Signed thumbnail URLs for photos in the private bucket, keyed by id. */
export const usePhotoUrls = (ids: PhotoId[]): Record<string, string> => {
  const sign = useAction(api.media.photoUrls);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = ids.join(",");

  useEffect(() => {
    if (key === "") {
      return;
    }

    let live = true;

    sign({ ids: key.split(",") as PhotoId[] }).then((rows) => {
      if (live) {
        setUrls((was) => ({
          ...was,
          ...Object.fromEntries(rows.map((row) => [row.id, row.url])),
        }));
      }
    });

    return () => {
      live = false;
    };
  }, [key, sign]);

  return urls;
};

export const Thumb = ({ url }: { url: string | undefined }): ReactNode =>
  url ? (
    <img
      alt=""
      className="aspect-square w-full rounded-lg bg-surface-2 object-cover"
      height={160}
      loading="lazy"
      src={url}
      width={160}
    />
  ) : (
    <div className="aspect-square w-full animate-pulse rounded-lg bg-surface-2" />
  );

// ── picking another article ──────────────────────────────────────────────────

const PickOption = ({
  article,
  busy,
  onPick,
}: {
  article: { date: number; id: ArticleId; title: string };
  busy: boolean;
  onPick: (id: ArticleId) => void;
}): ReactNode => {
  const handleClick = () => onPick(article.id);

  return (
    <li>
      <button
        className="w-full rounded-lg border border-border bg-surface p-2.5 text-start text-sm transition-colors hover:bg-surface-2 disabled:opacity-50"
        disabled={busy}
        onClick={handleClick}
        type="button"
      >
        <span className="block truncate">{article.title}</span>
        <span className="digits mt-0.5 block text-muted text-xs">
          {stamp(article.date)}
        </span>
      </button>
    </li>
  );
};

/** Finds an article by title. The archive has thousands; a drop-down would not do. */
export const ArticlePicker = ({
  busy,
  exclude,
  label,
  onCancel,
  onPick,
}: {
  busy: boolean;
  exclude?: ArticleId;
  label: string;
  onCancel: () => void;
  onPick: (id: ArticleId) => void;
}): ReactNode => {
  const [search, setSearch] = useState("");
  const { results, status } = usePaginatedQuery(
    api.admin.articles,
    { search },
    { initialNumItems: PICKER_SIZE }
  );

  const handleSearch = (event: ChangeEvent<HTMLInputElement>) =>
    setSearch(event.target.value);

  const options = results.filter((article) => article.id !== exclude);

  return (
    <div className="mt-2 rounded-lg border border-accent bg-accent-soft/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-sm">{label}</p>
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
        aria-label="ابحث عن المقالة"
        className={`${FIELD} mt-3`}
        onChange={handleSearch}
        placeholder="ابحث بعنوان المقالة…"
        type="search"
        value={search}
      />

      {status === "LoadingFirstPage" && <Spinner label="جارٍ البحث…" />}

      {status !== "LoadingFirstPage" && options.length === 0 && (
        <p className="mt-3 text-muted text-sm">لا مقالات مطابقة.</p>
      )}

      <ul className="mt-3 space-y-1">
        {options.slice(0, PICKER_SIZE).map((article) => (
          <PickOption
            article={article}
            busy={busy}
            key={article.id}
            onPick={onPick}
          />
        ))}
      </ul>
    </div>
  );
};

// ── one article ──────────────────────────────────────────────────────────────

const TextForm = ({
  busy,
  initial,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  initial: { text: string; title: string };
  onCancel: () => void;
  onSubmit: (values: { text: string; title: string }) => void;
}): ReactNode => {
  const [title, setTitle] = useState(initial.title);
  const [text, setText] = useState(initial.text);

  const handleTitle = (event: ChangeEvent<HTMLInputElement>) =>
    setTitle(event.target.value);
  const handleText = (event: ChangeEvent<HTMLTextAreaElement>) =>
    setText(event.target.value);
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({ text, title });
  };

  return (
    <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
      <label className="block text-sm">
        العنوان
        <input
          className={`${FIELD} mt-1`}
          onChange={handleTitle}
          required
          value={title}
        />
      </label>
      <label className="block text-sm">
        النص
        <textarea
          className={`${FIELD} mt-1 min-h-80 leading-8`}
          onChange={handleText}
          required
          value={text}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button className={PRIMARY} disabled={busy} type="submit">
          حفظ
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

const PhotoTile = ({
  busy,
  id,
  onUnlink,
  url,
}: {
  busy: boolean;
  id: PhotoId;
  onUnlink: (id: PhotoId) => void;
  url: string | undefined;
}): ReactNode => {
  const handleClick = () => onUnlink(id);

  return (
    <li className="relative">
      <Thumb url={url} />
      <button
        aria-label="إزالة الصورة من المقالة"
        className="absolute end-1 top-1 grid size-8 place-items-center rounded-full bg-surface/90 text-destructive shadow disabled:opacity-50"
        disabled={busy}
        onClick={handleClick}
        title="إزالة الصورة من المقالة"
        type="button"
      >
        <ImageOff aria-hidden="true" className="size-4" />
      </button>
    </li>
  );
};

const lockLabel = (locks: {
  photosLocked: boolean;
  textLocked: boolean;
}): string => {
  if (locks.textLocked && locks.photosLocked) {
    return "النص والصور مقفلة";
  }

  return locks.textLocked ? "النص مقفل" : "الصور مقفلة";
};

type Mode = "edit" | "delete" | "merge-next" | "merge-pick" | null;

const Detail = ({
  id,
  onClose,
  onSelect,
}: {
  id: ArticleId;
  onClose: () => void;
  onSelect: (id: ArticleId) => void;
}): ReactNode => {
  const state = useQuery({ args: { id }, query: api.admin.article });
  const updateArticle = useMutation(api.admin.updateArticle);
  const deleteArticle = useMutation(api.admin.deleteArticle);
  const mergeArticles = useMutation(api.admin.mergeArticles);
  const setArticlePhoto = useMutation(api.admin.setArticlePhoto);

  const [mode, setMode] = useState<Mode>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const article = state.status === "success" ? state.data : null;
  const urls = usePhotoUrls(article?.photoIds ?? []);

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

  const close = () => setMode(null);
  const handleEdit = () => setMode("edit");
  const handleDeleteMode = () => setMode("delete");
  const handleMergeNextMode = () => setMode("merge-next");
  const handleMergePickMode = () => setMode("merge-pick");

  if (state.status === "pending") {
    return <Spinner label="جارٍ تحميل المقالة…" />;
  }

  if (article === null) {
    return <Empty>حُذفت هذه المقالة أو دُمجت في غيرها.</Empty>;
  }

  const handleSave = (values: { text: string; title: string }) =>
    run(() => updateArticle({ id: article.id, ...values }), close);
  const handleDelete = () =>
    run(() => deleteArticle({ id: article.id }), onClose);
  const merge = (otherId: ArticleId) =>
    run(async () => {
      const survivor = await mergeArticles({ id: article.id, otherId });

      close();
      onSelect(survivor);
    });
  const handleMergeNext = () => {
    if (article.next) {
      merge(article.next.id);
    }
  };
  const handleUnlink = (mediaObjectId: PhotoId) =>
    run(() =>
      setArticlePhoto({ id: article.id, linked: false, mediaObjectId })
    );

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-lg leading-8">{article.title}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-muted text-xs">
            <span className="digits">{stamp(article.date)}</span>
            {(article.textLocked || article.photosLocked) && (
              <Chip tone="accent">
                <Lock aria-hidden="true" className="size-3" />
                {lockLabel(article)}
              </Chip>
            )}
            <a
              className="inline-flex items-center gap-1 text-accent underline underline-offset-4"
              href={article.telegramUrl}
              rel="noopener"
              target="_blank"
            >
              <ExternalLink aria-hidden="true" className="size-3.5" />
              تيليجرام
            </a>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            aria-label="تعديل المقالة"
            className={ICON_BUTTON}
            disabled={busy}
            onClick={handleEdit}
            title="تعديل المقالة"
            type="button"
          >
            <Pencil aria-hidden="true" className="size-4" />
          </button>
          <button
            aria-label="حذف المقالة"
            className={`${ICON_BUTTON} hover:text-destructive`}
            disabled={busy}
            onClick={handleDeleteMode}
            title="حذف المقالة"
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

      {error && <Banner>{error}</Banner>}

      {mode === "delete" && (
        <div className="mt-4 rounded-lg border border-destructive p-3">
          <p className="text-sm leading-7">
            تُحذف المقالة من الموقع ولن يعيدها خط المعالجة. الصور المرتبطة بها
            تعود إلى قائمة الصور بلا مقالة.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className={DANGER}
              disabled={busy}
              onClick={handleDelete}
              type="button"
            >
              <Trash2 aria-hidden="true" className="size-4" />
              تأكيد الحذف
            </button>
            <button
              className={SECONDARY}
              disabled={busy}
              onClick={close}
              type="button"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {mode === "edit" ? (
        <TextForm
          busy={busy}
          initial={article}
          onCancel={close}
          onSubmit={handleSave}
        />
      ) : (
        <>
          <h3 className="mt-6 font-medium text-sm">
            الصور ({article.photoIds.length})
          </h3>
          {article.photoIds.length === 0 ? (
            <p className="mt-2 text-muted text-sm">
              لا صور. اربط صورة من قسم «الصور».
            </p>
          ) : (
            <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {article.photoIds.map((photoId) => (
                <PhotoTile
                  busy={busy}
                  id={photoId}
                  key={photoId}
                  onUnlink={handleUnlink}
                  url={urls[photoId]}
                />
              ))}
            </ul>
          )}

          <h3 className="mt-6 font-medium text-sm">الدمج</h3>
          <p className="mt-1 text-muted text-xs leading-6">
            تُلحق المقالة اللاحقة زمنيًا بنهاية السابقة مع صورها، وتُحذف اللاحقة.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {article.next && (
              <button
                className={SECONDARY}
                disabled={busy}
                onClick={handleMergeNextMode}
                type="button"
              >
                <Combine aria-hidden="true" className="size-4" />
                دمج مع المقالة التالية
              </button>
            )}
            <button
              className={SECONDARY}
              disabled={busy}
              onClick={handleMergePickMode}
              type="button"
            >
              <Search aria-hidden="true" className="size-4" />
              دمج مع مقالة أخرى…
            </button>
          </div>

          {mode === "merge-next" && article.next && (
            <div className="mt-2 rounded-lg border border-accent bg-accent-soft/40 p-3">
              <p className="font-medium text-sm">{article.next.title}</p>
              <p className="digits mt-0.5 text-muted text-xs">
                {stamp(article.next.date)}
              </p>
              <p className="mt-2 line-clamp-4 text-muted text-sm leading-7">
                {article.next.preview}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className={PRIMARY}
                  disabled={busy}
                  onClick={handleMergeNext}
                  type="button"
                >
                  <Combine aria-hidden="true" className="size-4" />
                  تأكيد الدمج
                </button>
                <button
                  className={SECONDARY}
                  disabled={busy}
                  onClick={close}
                  type="button"
                >
                  إلغاء
                </button>
              </div>
            </div>
          )}

          {mode === "merge-pick" && (
            <ArticlePicker
              busy={busy}
              exclude={article.id}
              label="اختر المقالة التي تُدمج مع هذه"
              onCancel={close}
              onPick={merge}
            />
          )}

          <h3 className="mt-6 font-medium text-sm">النص</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-8">
            {article.text}
          </p>
        </>
      )}
    </div>
  );
};

// ── the browser ──────────────────────────────────────────────────────────────

const ArticleRow = ({
  article,
  onSelect,
  selected,
}: {
  article: { date: number; id: ArticleId; preview: string; title: string };
  onSelect: (id: ArticleId) => void;
  selected: boolean;
}): ReactNode => {
  const handleClick = () => onSelect(article.id);

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
        <p className="font-medium text-sm leading-7">{article.title}</p>
        <p className="mt-1 line-clamp-2 text-muted text-xs leading-6">
          {article.preview}
        </p>
        <p className="digits mt-1 text-muted text-xs">{stamp(article.date)}</p>
      </button>
    </li>
  );
};

export const Articles = (): ReactNode => {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ArticleId | null>(null);
  const { isLoading, loadMore, results, status } = usePaginatedQuery(
    api.admin.articles,
    { search },
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

        <ul className="mt-4 space-y-2">
          {results.map((article) => (
            <ArticleRow
              article={article}
              key={article.id}
              onSelect={setSelected}
              selected={selected === article.id}
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

      <div className="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
        {selected === null ? (
          <Empty>اختر مقالة لتعديلها أو دمجها.</Empty>
        ) : (
          <Detail
            id={selected}
            key={selected}
            onClose={handleClose}
            onSelect={setSelected}
          />
        )}
      </div>
    </div>
  );
};
