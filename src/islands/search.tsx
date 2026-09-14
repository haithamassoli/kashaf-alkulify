import {
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
  useRef,
  useState,
} from "react";
import { highlightWords } from "../lib/highlight";

interface Hit {
  charEnd: number;
  charStart: number;
  context: string;
  id: string;
  partOrder?: number;
  sourceId: string;
  startMs?: number;
  text: string;
  title: string;
  url: string;
}

interface SearchResponse {
  candidateLimitReached?: boolean;
  degraded: unknown[];
  hits: Hit[];
  pilot?: boolean;
  widened?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isHit = (value: unknown): value is Hit =>
  isRecord(value) &&
  ["id", "sourceId", "context", "text", "title", "url"].every(
    (key) => typeof value[key] === "string"
  ) &&
  typeof value.charStart === "number" &&
  typeof value.charEnd === "number" &&
  (value.startMs === undefined || typeof value.startMs === "number") &&
  (value.partOrder === undefined || typeof value.partOrder === "number");

const isResponse = (value: unknown): value is SearchResponse =>
  isRecord(value) &&
  Array.isArray(value.hits) &&
  value.hits.every(isHit) &&
  Array.isArray(value.degraded);

const timestamp = (milliseconds: number): string => {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
};

const lessonHref = (hit: Hit, query: string): string => {
  const params = new URLSearchParams({ id: hit.sourceId });

  if (hit.startMs !== undefined) {
    params.set("t", String(Math.floor(hit.startMs / 1000)));
  }
  if (query) {
    params.set("q", query);
  }

  return `/v/?${params}`;
};

const resultMessage = (result: SearchResponse): string => {
  const notices: string[] = [];

  if (result.pilot) {
    notices.push("نسخة تجريبية تبحث في عينة من الأرشيف فقط.");
  }
  if (result.widened) {
    notices.push("لم نجد مطابقة مباشرة. هذه أقرب النتائج التي وجدناها.");
  }
  if (result.degraded.length > 0) {
    notices.push("بعض وظائف البحث غير متاحة؛ قد تكون النتائج ناقصة.");
  }
  if (result.hits.length === 0) {
    notices.push("لم نجد نتائج. جرّب الكلمات الأساسية وحدها أو عبارة أقصر.");
  }
  if (result.candidateLimitReached) {
    notices.push("المعروض مجموعة من النتائج، وليس حصرًا لجميع المواضع.");
  }

  return notices.join(" ");
};

export default function Search({ endpoint }: { endpoint: string }) {
  const [scope, setScope] = useState("audio");
  const [mode, setMode] = useState("hybrid");
  const [occurrences, setOccurrences] = useState(false);
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(20);
  const request = useRef<AbortController | null>(null);
  const results = useRef<HTMLDivElement>(null);

  const reset = () => {
    request.current?.abort();
    setBusy(false);
    setHits([]);
    setMessage("");
  };

  const run = async (nextScope = scope) => {
    const text = query.trim();

    reset();
    if (!(endpoint && text)) {
      if (!endpoint) {
        setMessage("البحث قيد التجهيز. يرجى المحاولة لاحقًا.");
      }
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    setAsked(text);
    setBusy(true);

    try {
      const response = await fetch(`${endpoint}/search`, {
        body: JSON.stringify({
          allOccurrences: occurrences,
          mode,
          query: text,
          scope: nextScope,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(180_000),
        ]),
      });

      if (!response.ok) {
        throw new Error("Search unavailable");
      }

      const result: unknown = await response.json();

      if (!isResponse(result)) {
        throw new Error("Invalid search response");
      }
      if (controller.signal.aborted) {
        return;
      }

      setHits(result.hits);
      setVisible(20);
      setMessage(resultMessage(result));
      requestAnimationFrame(() => results.current?.focus());
    } catch {
      if (!controller.signal.aborted) {
        setMessage("تعذّر إتمام البحث الآن. حاول مرة أخرى بعد قليل.");
      }
    } finally {
      if (request.current === controller) {
        setBusy(false);
      }
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run();
  };

  const changeScope = (event: MouseEvent<HTMLButtonElement>) => {
    const next = event.currentTarget.value;

    setScope(next);
    if (query.trim()) {
      run(next);
    } else {
      reset();
    }
  };

  const changeQuery = (event: ChangeEvent<HTMLInputElement>) =>
    setQuery(event.target.value);

  const changeMode = (event: ChangeEvent<HTMLInputElement>) => {
    reset();
    setMode(event.target.checked ? "phrase" : "hybrid");
  };

  const changeOccurrences = (event: ChangeEvent<HTMLInputElement>) => {
    reset();
    setOccurrences(event.target.checked);
  };

  const showMore = () => setVisible((current) => current + 20);

  return (
    <section aria-label="البحث في الدروس والمقالات" className="mt-8">
      <search>
        <form onSubmit={submit}>
          <label className="sr-only" htmlFor="search-query">
            ابحث في نصوص الدروس والمقالات
          </label>
          <div className="flex gap-2">
            <input
              autoComplete="off"
              autoFocus
              className="h-12 min-w-0 flex-1 rounded-xl border border-border-strong bg-surface px-4 text-base placeholder:text-muted"
              data-search-input
              enterKeyHint="search"
              id="search-query"
              maxLength={500}
              onChange={changeQuery}
              placeholder="مثال: كفارة اليمين"
              required
              spellCheck={false}
              type="search"
              value={query}
            />
            <button
              className="h-12 shrink-0 rounded-xl bg-accent px-6 font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
              disabled={busy || !query.trim()}
              type="submit"
            >
              {busy ? "جارٍ البحث…" : "بحث"}
            </button>
          </div>

          <nav
            aria-label="نوع النتائج"
            className="mt-6 flex gap-2 border-border border-b"
          >
            {[
              { label: "الدروس الصوتية", value: "audio" },
              { label: "المقالات", value: "articles" },
            ].map((option) => (
              <button
                aria-pressed={scope === option.value}
                className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm transition-colors ${
                  scope === option.value
                    ? "border-accent font-medium text-fg"
                    : "border-transparent text-muted hover:text-fg"
                }`}
                key={option.value}
                onClick={changeScope}
                type="button"
                value={option.value}
              >
                {option.label}
                {scope === option.value && hits.length > 0 && (
                  <span className="digits text-xs">{hits.length}</span>
                )}
              </button>
            ))}
          </nav>

          <details className="mt-3 text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center text-muted hover:text-fg">
              خيارات البحث
            </summary>
            <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-surface-2 px-4 py-2">
              <label className="flex min-h-11 items-center gap-2">
                <input
                  checked={mode === "phrase"}
                  onChange={changeMode}
                  type="checkbox"
                />
                مطابقة العبارة بالترتيب نفسه
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  checked={occurrences}
                  onChange={changeOccurrences}
                  type="checkbox"
                />
                إظهار المواضع المتعددة من الدرس نفسه
              </label>
            </div>
          </details>
        </form>
      </search>

      <div
        aria-atomic="true"
        aria-live="polite"
        className="mt-10 scroll-mt-20 outline-none"
        ref={results}
        tabIndex={-1}
      >
        {busy && <p className="text-muted text-sm">جارٍ البحث…</p>}
        {!busy && hits.length > 0 && (
          <p className="text-muted text-sm">
            النتائج من <span className="digits">1</span> إلى{" "}
            <span className="digits">{Math.min(visible, hits.length)}</span> من
            أصل <span className="digits">{hits.length}</span>
          </p>
        )}
        {!busy && message && (
          <p className="mt-2 text-muted text-sm">{message}</p>
        )}
      </div>

      {busy && (
        <ul aria-hidden="true" className="mt-4 space-y-3">
          {[0, 1, 2, 3, 4].map((item) => (
            <li className="card animate-pulse p-4" key={item}>
              <div className="h-4 w-2/5 rounded bg-surface-2" />
              <div className="mt-5 h-3 w-full rounded bg-surface-2" />
              <div className="mt-3 h-3 w-4/5 rounded bg-surface-2" />
            </li>
          ))}
        </ul>
      )}

      <ol aria-busy={busy} className="mt-4 space-y-3">
        {hits.slice(0, visible).map((hit) => {
          const href =
            scope === "audio" ? lessonHref(hit, asked) : hit.url || undefined;
          const content = (
            <>
              <h2 className="font-medium text-base text-fg" data-vt-title>
                {highlightWords(hit.title, asked)}
              </h2>
              <p className="prose-read mt-2 line-clamp-4 whitespace-pre-wrap text-muted">
                {highlightWords(hit.context, asked)}
              </p>
              <p className="mt-3 flex flex-wrap items-center gap-x-2 text-muted text-xs">
                <span className="rounded-full bg-surface-2 px-2 py-0.5">
                  {scope === "audio" ? "درس صوتي" : "مقالة"}
                </span>
                {hit.startMs !== undefined && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="digits">{timestamp(hit.startMs)}</span>
                  </>
                )}
              </p>
            </>
          );

          return (
            <li key={hit.id}>
              {href ? (
                <a
                  className="card block p-4 transition-colors hover:bg-surface-2"
                  href={href}
                  rel={scope === "articles" ? "noopener noreferrer" : undefined}
                  target={scope === "articles" ? "_blank" : undefined}
                >
                  {content}
                </a>
              ) : (
                <article className="card p-4">{content}</article>
              )}
            </li>
          );
        })}
      </ol>

      {visible < hits.length && (
        <button
          className="mt-6 min-h-11 rounded-lg border border-border-strong px-5 text-sm transition-colors hover:bg-surface-2"
          onClick={showMore}
          type="button"
        >
          نتائج إضافية
        </button>
      )}
    </section>
  );
}
