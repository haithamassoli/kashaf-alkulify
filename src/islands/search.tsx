import { Combobox } from "@base-ui/react/combobox";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../../convex/_generated/api";
import { normalize } from "../../convex/lib/normalize";
import { convex } from "../lib/convex";
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

interface Options {
  exact: boolean;
  query: string;
  scope: string;
  series: string[];
  spread: boolean;
}

interface SeriesOption {
  count: number;
  name: string;
}

/** Nothing selected means no filter, so the trigger says «all» rather than staying empty. */
const seriesLabel = (names: string[]): string => {
  if (names.length === 0) {
    return "كل السلاسل";
  }
  if (names.length === 1) {
    return names[0] ?? "";
  }
  if (names.length === 2) {
    return "سلسلتان";
  }
  return `${names.length} ${names.length <= 10 ? "سلاسل" : "سلسلة"}`;
};

const MAX_SERIES = 20;

const SCOPES = [
  { label: "الدروس الصوتية", value: "audio" },
  { label: "المقالات", value: "articles" },
];

const chip = (active: boolean): string =>
  `inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors ${
    active
      ? "border-accent bg-accent-soft font-medium text-accent"
      : "border-border text-muted hover:border-border-strong hover:text-fg"
  }`;

// The URL holds the search, so reloads, shared links and
// "back to results" all land on the same search.
const fromUrl = (): Options => {
  const params = new URLSearchParams(window.location.search);

  return {
    exact: params.get("exact") === "1",
    query: params.get("q")?.trim() ?? "",
    scope: params.get("scope") === "articles" ? "articles" : "audio",
    series: params.getAll("s").slice(0, MAX_SERIES),
    spread: params.get("all") === "1",
  };
};

const toUrl = ({ exact, query, scope, series, spread }: Options) => {
  const params = new URLSearchParams();

  if (query) {
    params.set("q", query);
  }
  if (scope !== "audio") {
    params.set("scope", scope);
  }
  if (scope === "audio") {
    for (const name of series) {
      params.append("s", name);
    }
  }
  if (exact) {
    params.set("exact", "1");
  }
  if (spread) {
    params.set("all", "1");
  }

  const search = params.size > 0 ? `?${params}` : "";
  history.replaceState(history.state, "", `${location.pathname}${search}`);
};

const fetchSearch = async (
  endpoint: string,
  { exact, query, scope, series, spread }: Options,
  signal: AbortSignal
): Promise<SearchResponse> => {
  const response = await fetch(`${endpoint}/search`, {
    body: JSON.stringify({
      allOccurrences: spread,
      mode: exact ? "phrase" : "hybrid",
      query: query.trim(),
      scope,
      ...(scope === "audio" && series.length > 0 && { series }),
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
  });

  if (!response.ok) {
    throw new Error("Search unavailable");
  }

  const result: unknown = await response.json();

  if (!isResponse(result)) {
    throw new Error("Invalid search response");
  }
  return result;
};

export default function Search({ endpoint }: { endpoint: string }) {
  const [options, setOptions] = useState<Options>({
    exact: false,
    query: "",
    scope: "audio",
    series: [],
    spread: false,
  });
  const [seriesList, setSeriesList] = useState<SeriesOption[]>([]);
  const counts = useMemo(
    () => new Map(seriesList.map((item) => [item.name, item.count])),
    [seriesList]
  );
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(20);
  const request = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const { exact, scope, series, spread } = options;

  const reset = () => {
    request.current?.abort();
    setBusy(false);
    setHits([]);
    setMessage("");
  };

  const run = async (next: Options, focusResults = true) => {
    const text = next.query.trim();

    setOptions(next);
    toUrl({ ...next, query: text });
    reset();
    if (!(endpoint && text)) {
      setAsked("");
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
      const result = await fetchSearch(endpoint, next, controller.signal);

      if (controller.signal.aborted) {
        return;
      }

      setHits(result.hits);
      setVisible(20);
      setMessage(resultMessage(result));
      if (focusResults) {
        requestAnimationFrame(() => results.current?.focus());
      }
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

  // Restore a search from the URL (reload, shared link, back from a lesson).
  useEffect(() => {
    const saved = fromUrl();

    setQuery(saved.query);
    setOptions(saved);
    if (saved.query) {
      run(saved, false);
    }
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run({ ...options, query });
  };

  // Filters re-run the last search right away instead of wiping the results.
  const refine = (change: Partial<Options>) => {
    const next = { ...options, ...change, query };

    if (next.query.trim()) {
      run(next, false);
      return;
    }
    setOptions(next);
    toUrl(next);
  };

  const changeScope = (event: MouseEvent<HTMLButtonElement>) =>
    refine({ scope: event.currentTarget.value });

  const changeSeries = (value: string[]) =>
    refine({ series: value.slice(0, MAX_SERIES) });

  const clearSeries = () => changeSeries([]);

  // The list is only fetched once someone opens the filter.
  const loadSeries = (open: boolean) => {
    if (!open || seriesList.length > 0) {
      return;
    }
    convex
      .query(api.content.series, {
        paginationOpts: { cursor: null, numItems: 1000 },
        search: "",
      })
      .then((page) => setSeriesList(page.page))
      .catch(() => setSeriesList([]));
  };

  const filterSeries = (name: string, text: string) =>
    normalize(name).includes(normalize(text));

  const toggleExact = () => refine({ exact: !exact });

  const toggleSpread = () => refine({ spread: !spread });

  const changeQuery = (event: ChangeEvent<HTMLInputElement>) =>
    setQuery(event.target.value);

  const clear = () => {
    setQuery("");
    setAsked("");
    reset();
    toUrl({ ...options, query: "" });
    input.current?.focus();
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
            <div className="relative min-w-0 flex-1">
              <input
                autoComplete="off"
                autoFocus
                className="h-12 w-full rounded-xl border border-border-strong bg-surface ps-4 pe-11 text-base outline-none transition-colors placeholder:text-muted focus:border-accent focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
                data-search-input
                enterKeyHint="search"
                id="search-query"
                maxLength={500}
                onChange={changeQuery}
                placeholder="مثل: التأمين التعاوني"
                ref={input}
                required
                spellCheck={false}
                type="search"
                value={query}
              />
              {query && (
                <button
                  aria-label="مسح البحث"
                  className="absolute inset-y-0 end-1 my-auto grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                  onClick={clear}
                  type="button"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              )}
            </div>
            <button
              className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-accent px-6 font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
              disabled={busy || !query.trim()}
              type="submit"
            >
              {busy && (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              )}
              بحث
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <fieldset className="inline-flex rounded-full bg-surface-2 p-1">
              <legend className="sr-only">مكان البحث</legend>
              {SCOPES.map((option) => (
                <button
                  aria-pressed={scope === option.value}
                  className={`min-h-9 rounded-full px-4 text-sm transition-colors ${
                    scope === option.value
                      ? "bg-surface font-medium text-fg shadow-sm"
                      : "text-muted hover:text-fg"
                  }`}
                  key={option.value}
                  onClick={changeScope}
                  type="button"
                  value={option.value}
                >
                  {option.label}
                </button>
              ))}
            </fieldset>

            <button
              aria-pressed={exact}
              className={chip(exact)}
              onClick={toggleExact}
              title="تظهر النتائج التي فيها كلماتك متتالية بالترتيب نفسه"
              type="button"
            >
              {exact && <Check aria-hidden="true" className="size-3.5" />}
              العبارة كما هي
            </button>
            {scope === "audio" && (
              <button
                aria-pressed={spread}
                className={chip(spread)}
                onClick={toggleSpread}
                title="إظهار كل موضع ورد فيه البحث داخل الدرس الواحد"
                type="button"
              >
                {spread && <Check aria-hidden="true" className="size-3.5" />}
                كل المواضع في الدرس
              </button>
            )}
          </div>

          {scope === "audio" && (
            <div className="mt-3 flex items-center gap-3">
              {/* Base UI takes direction from context, not the page's <html dir>. */}
              <DirectionProvider direction="rtl">
                <Combobox.Root
                  filter={filterSeries}
                  items={seriesList.map((item) => item.name)}
                  multiple
                  onOpenChange={loadSeries}
                  onValueChange={changeSeries}
                  value={series}
                >
                  <Combobox.Trigger
                    aria-label="السلسلة"
                    className="flex h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-border-strong bg-surface px-3 text-fg text-sm transition-colors hover:bg-surface-2 sm:max-w-xs"
                  >
                    <span className="truncate">{seriesLabel(series)}</span>
                    <ChevronDown
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted"
                    />
                  </Combobox.Trigger>
                  <Combobox.Portal>
                    <Combobox.Positioner className="z-50" sideOffset={4}>
                      <Combobox.Popup
                        aria-label="السلسلة"
                        className="min-w-(--anchor-width) max-w-(--available-width) overflow-hidden rounded-lg bg-surface text-fg shadow-md ring-1 ring-border"
                      >
                        <Combobox.Input
                          className="h-11 w-full border-border border-b bg-transparent px-3 text-base outline-none placeholder:text-muted focus-visible:outline-none"
                          placeholder="ابحث في السلاسل"
                        />
                        <Combobox.Empty>
                          <p className="px-3 py-4 text-muted text-sm">
                            {seriesList.length > 0
                              ? "لا سلاسل مطابقة"
                              : "جارٍ التحميل…"}
                          </p>
                        </Combobox.Empty>
                        <Combobox.List className="max-h-64 overflow-y-auto overscroll-contain p-1">
                          {(name: string) => (
                            <Combobox.Item
                              className="relative flex cursor-default select-none items-center gap-2 rounded-md py-2 ps-2 pe-8 text-sm outline-none data-highlighted:bg-surface-2"
                              key={name}
                              value={name}
                            >
                              <span className="truncate">{name}</span>
                              <span className="digits shrink-0 text-muted text-xs">
                                ({counts.get(name)})
                              </span>
                              <Combobox.ItemIndicator className="absolute end-2 flex size-4 items-center justify-center">
                                <Check aria-hidden="true" className="size-4" />
                              </Combobox.ItemIndicator>
                            </Combobox.Item>
                          )}
                        </Combobox.List>
                      </Combobox.Popup>
                    </Combobox.Positioner>
                  </Combobox.Portal>
                </Combobox.Root>
              </DirectionProvider>
              {series.length > 0 && (
                <button
                  className="shrink-0 text-muted text-sm underline underline-offset-4 hover:text-fg"
                  onClick={clearSeries}
                  type="button"
                >
                  إلغاء
                </button>
              )}
            </div>
          )}
        </form>
      </search>

      <div
        aria-atomic="true"
        aria-live="polite"
        className="mt-8 scroll-mt-20 outline-none"
        ref={results}
        tabIndex={-1}
      >
        {busy && <p className="text-muted text-sm">جارٍ البحث…</p>}
        {!busy && hits.length > 0 && (
          <p className="text-muted text-sm">
            <span className="digits font-medium text-fg">{hits.length}</span>{" "}
            نتيجة عن «{asked}»
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
