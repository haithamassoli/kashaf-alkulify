import {
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
  type SyntheticEvent,
  useRef,
  useState,
} from "react";

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

const timestamp = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

interface SearchResponse {
  candidateLimitReached?: boolean;
  degraded: unknown[];
  hits: Hit[];
  pilot?: boolean;
  widened?: boolean;
}

const isResponse = (value: unknown): value is SearchResponse =>
  isRecord(value) &&
  Array.isArray(value.hits) &&
  value.hits.every(isHit) &&
  Array.isArray(value.degraded);

const resultMessage = (result: SearchResponse) => {
  const notices: string[] = [];
  if (result.pilot) {
    notices.push("نسخة تجريبية تبحث في عينة من الأرشيف فقط.");
  }
  if (result.widened) {
    notices.push("لم نجد مطابقة مباشرة. هذه نتائج أوسع قد تساعدك.");
  }
  if (result.degraded.length > 0) {
    notices.push(
      "بعض وظائف البحث غير متاحة أو بعض المصادر تغيّرت؛ النتائج قد تكون ناقصة."
    );
  }
  if (result.hits.length === 0) {
    notices.push(
      "لم نجد نتائج مناسبة. جرّب عبارة أقصر أو صياغة أخرى؛ هذا لا يعني أن الشيخ لم يتكلم عن الموضوع."
    );
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
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(10);
  const [playback, setPlayback] = useState<{
    captions: string;
    hitId: string;
    seconds: number;
    url: string;
  } | null>(null);
  const request = useRef<AbortController | null>(null);
  const playerRequest = useRef<AbortController | null>(null);

  const reset = () => {
    request.current?.abort();
    playerRequest.current?.abort();
    setBusy(false);
    setHits([]);
    setPlayback(null);
    setMessage("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    reset();
    if (!endpoint) {
      setMessage("البحث قيد التجهيز. يرجى المحاولة لاحقًا.");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage("جارٍ البحث في المصادر…");
    try {
      const response = await fetch(`${endpoint}/search`, {
        body: JSON.stringify({
          allOccurrences: occurrences,
          mode,
          query,
          scope,
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
      setVisible(10);
      setMessage(resultMessage(result));
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

  const play = async (hit: Hit) => {
    playerRequest.current?.abort();
    const controller = new AbortController();
    playerRequest.current = controller;
    try {
      const response = await fetch(`${endpoint}/playback`, {
        body: JSON.stringify({
          partOrder: hit.partOrder,
          sourceId: hit.sourceId,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(30_000),
        ]),
      });
      const result: unknown = await response.json();
      if (
        !(response.ok && isRecord(result)) ||
        typeof result.url !== "string" ||
        !result.url.startsWith("https://") ||
        typeof result.offsetMs !== "number" ||
        typeof result.captions !== "string" ||
        !result.captions.startsWith("data:text/vtt;")
      ) {
        throw new Error("Playback unavailable");
      }
      if (!controller.signal.aborted) {
        setPlayback({
          captions: result.captions,
          hitId: hit.id,
          seconds: Math.max(0, ((hit.startMs ?? 0) - result.offsetMs) / 1000),
          url: result.url,
        });
      }
    } catch {
      if (!controller.signal.aborted) {
        setMessage("تعذّر فتح الصوت، أو تغيّر المصدر. أعد البحث.");
      }
    }
  };

  const changeScope = (event: MouseEvent<HTMLButtonElement>) => {
    reset();
    setScope(event.currentTarget.value);
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
  const playHit = (event: MouseEvent<HTMLButtonElement>) => {
    const hit = hits.find(
      (item) => item.id === event.currentTarget.dataset.hit
    );
    if (hit) {
      return play(hit);
    }
  };
  const seek = (event: SyntheticEvent<HTMLAudioElement>) => {
    event.currentTarget.currentTime = playback?.seconds ?? 0;
  };
  const showMore = () => setVisible((current) => current + 10);

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
                className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm transition-colors ${
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
                إظهار المواضع المتعددة من المصدر نفسه
              </label>
              {mode === "phrase" && (
                <p className="w-full pb-2 text-muted">
                  نتجاهل التشكيل والتطويل وعلامات الترقيم، ونحافظ على الهمزة
                  والتاء المربوطة والألف المقصورة.
                </p>
              )}
            </div>
          </details>
        </form>
      </search>

      <div
        aria-live="polite"
        className="mt-8 scroll-mt-20 outline-none"
        role="status"
      >
        {busy && <p className="text-muted text-sm">جارٍ البحث…</p>}
        {!busy && hits.length > 0 && (
          <p className="text-muted text-sm">
            عُثر على <span className="digits">{hits.length}</span> نتيجة
          </p>
        )}
        {!busy && message && <p className="text-muted leading-8">{message}</p>}
      </div>

      {busy && (
        <ul aria-hidden="true" className="mt-4 space-y-3">
          {[0, 1, 2].map((item) => (
            <li className="card animate-pulse p-4" key={item}>
              <div className="h-4 w-2/5 rounded bg-surface-2" />
              <div className="mt-5 h-3 w-full rounded bg-surface-2" />
              <div className="mt-3 h-3 w-4/5 rounded bg-surface-2" />
            </li>
          ))}
        </ul>
      )}

      <ol aria-busy={busy} className="mt-4 space-y-3">
        {hits.slice(0, visible).map((hit) => (
          <li
            className="card p-4 transition-colors hover:bg-surface-2"
            key={hit.id}
          >
            <p className="text-muted text-xs">
              <span className="rounded-full bg-surface-2 px-2 py-0.5">
                {scope === "articles" ? "مقالة" : "درس صوتي"}
              </span>
            </p>
            <h2 className="mt-2 font-medium text-base text-fg">{hit.title}</h2>
            <blockquote className="prose-read mt-2 line-clamp-3 whitespace-pre-wrap text-muted">
              {hit.text}
            </blockquote>
            <details className="mt-3">
              <summary className="inline-flex min-h-11 cursor-pointer items-center text-accent">
                قراءة السياق
              </summary>
              <p className="prose-read whitespace-pre-wrap rounded-lg bg-surface-2 p-3">
                {hit.context}
              </p>
            </details>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 text-sm">
              {hit.startMs !== undefined && (
                <button
                  className="inline-flex min-h-11 items-center text-accent underline underline-offset-4"
                  data-hit={hit.id}
                  onClick={playHit}
                  type="button"
                >
                  استمع من {timestamp(hit.startMs)}
                </button>
              )}
              {hit.url.startsWith("https://") && (
                <a
                  className="inline-flex min-h-11 items-center text-accent underline underline-offset-4"
                  href={hit.url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  المصدر الأصلي
                </a>
              )}
            </div>
            {playback?.hitId === hit.id && (
              <audio
                aria-label={`استمع إلى ${hit.title}`}
                className="mt-3 w-full"
                controls
                key={playback.url}
                onLoadedMetadata={seek}
                preload="metadata"
                src={playback.url}
              >
                <track
                  kind="captions"
                  label="التفريغ العربي"
                  src={playback.captions}
                  srcLang="ar"
                />
              </audio>
            )}
          </li>
        ))}
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
