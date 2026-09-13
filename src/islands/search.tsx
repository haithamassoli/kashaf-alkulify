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

  const changeScope = (event: ChangeEvent<HTMLInputElement>) => {
    reset();
    setScope(event.target.value);
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
  const showMore = () => setVisible(visible + 10);

  return (
    <section aria-label="البحث في الدروس والمقالات" className="mt-8">
      <search>
        <form className="space-y-4" onSubmit={submit}>
          <fieldset className="flex gap-6">
            <legend className="mb-2 font-medium">أين تريد البحث؟</legend>
            {[
              { label: "الدروس الصوتية", value: "audio" },
              { label: "المقالات", value: "articles" },
            ].map((option) => (
              <label
                className="flex min-h-11 items-center gap-2"
                key={option.value}
              >
                <input
                  checked={scope === option.value}
                  name="scope"
                  onChange={changeScope}
                  type="radio"
                  value={option.value}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <label className="block" htmlFor="search-query">
            عبارة سمعتها، أو موضوع تريد العثور عليه
          </label>
          <div className="flex gap-2">
            <input
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-current/20 bg-transparent px-3"
              id="search-query"
              maxLength={500}
              onChange={changeQuery}
              required
              type="search"
              value={query}
            />
            <button
              className="min-h-11 rounded-lg bg-accent px-5 text-accent-fg disabled:opacity-50"
              disabled={busy || !query.trim()}
              type="submit"
            >
              {busy ? "جارٍ البحث…" : "بحث"}
            </button>
          </div>
          <label className="flex min-h-11 items-center gap-2">
            <input
              checked={mode === "phrase"}
              onChange={changeMode}
              type="checkbox"
            />
            مطابقة العبارة بالترتيب نفسه
          </label>
          {mode === "phrase" && (
            <p className="text-muted text-sm">
              نتجاهل التشكيل والتطويل وعلامات الترقيم، ونحافظ على الهمزة والتاء
              المربوطة والألف المقصورة.
            </p>
          )}
          <label className="flex min-h-11 items-center gap-2">
            <input
              checked={occurrences}
              onChange={changeOccurrences}
              type="checkbox"
            />
            إظهار المواضع المتعددة من المصدر نفسه
          </label>
        </form>
      </search>
      <p aria-live="polite" className="my-5 text-muted leading-8" role="status">
        {message}
      </p>
      <ol aria-busy={busy} className="space-y-5">
        {hits.slice(0, visible).map((hit) => (
          <li className="rounded-lg border border-current/15 p-4" key={hit.id}>
            <h2 className="font-semibold">{hit.title}</h2>
            <blockquote className="mt-3 whitespace-pre-wrap leading-8">
              {hit.text}
            </blockquote>
            <details className="mt-3">
              <summary className="min-h-11 cursor-pointer py-2 text-accent">
                قراءة السياق
              </summary>
              <p className="whitespace-pre-wrap leading-8">{hit.context}</p>
            </details>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              {hit.startMs !== undefined && (
                <button
                  className="min-h-11 text-accent underline"
                  data-hit={hit.id}
                  onClick={playHit}
                  type="button"
                >
                  استمع من {timestamp(hit.startMs)}
                </button>
              )}
              {hit.url.startsWith("https://") && (
                <a
                  className="inline-flex min-h-11 items-center text-accent underline"
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
          className="mt-5 min-h-11 rounded-lg border px-5"
          onClick={showMore}
          type="button"
        >
          نتائج إضافية
        </button>
      )}
    </section>
  );
}
