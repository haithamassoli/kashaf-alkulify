import type { MediaPlayerInstance } from "@vidstack/react";
import { Check, Copy } from "lucide-react";
import {
  type ChangeEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import { timestamp } from "../lib/format";
import { highlightWords, normalizeArabic } from "../lib/highlight";
import { lessonPath } from "../lib/paths";
import { Actions } from "./actions";
import { AudioPlayer } from "./audio-player";

interface Part {
  durationMs: number;
  offsetMs: number;
  order: number;
  url: string;
}

interface Segment {
  endMs: number;
  partOrder: number;
  startMs: number;
  text: string;
}

interface LessonData {
  durationMs: number;
  parts: Part[];
  segments: Segment[];
  sourceId: string;
  title: string;
  url: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isPart = (value: unknown): value is Part =>
  isRecord(value) &&
  typeof value.durationMs === "number" &&
  typeof value.offsetMs === "number" &&
  typeof value.order === "number" &&
  typeof value.url === "string" &&
  value.url.startsWith("https://");

const isSegment = (value: unknown): value is Segment =>
  isRecord(value) &&
  typeof value.endMs === "number" &&
  typeof value.partOrder === "number" &&
  typeof value.startMs === "number" &&
  typeof value.text === "string";

const isLesson = (value: unknown): value is LessonData =>
  isRecord(value) &&
  typeof value.durationMs === "number" &&
  Array.isArray(value.parts) &&
  value.parts.length > 0 &&
  value.parts.every(isPart) &&
  Array.isArray(value.segments) &&
  value.segments.every(isSegment) &&
  typeof value.sourceId === "string" &&
  typeof value.title === "string" &&
  typeof value.url === "string" &&
  (value.url === "" || value.url.startsWith("https://"));

const partAt = (parts: Part[], milliseconds: number): number => {
  const found = parts.findIndex(
    (part) =>
      part.offsetMs <= milliseconds &&
      milliseconds < part.offsetMs + part.durationMs
  );

  return found < 0 ? Math.max(0, parts.length - 1) : found;
};

/** ponytail: linear cue scan; restore binary search only if profiling shows it matters. */
const segmentAt = (segments: Segment[], milliseconds: number): number =>
  segments.findLastIndex((segment) => segment.startMs <= milliseconds);

interface Props {
  endpoint: string;
  id: string;
  title: string;
  /**
   * The page's static transcript. It stays readable while the player loads, and
   * when it cannot; this island hides it only once the synced view replaces it.
   */
  transcriptId: string;
}

export default function Lesson({
  endpoint,
  id,
  title,
  transcriptId,
}: Props): ReactNode {
  const player = useRef<MediaPlayerInstance>(null);
  const list = useRef<HTMLOListElement>(null);
  const active = useRef(-1);
  const follow = useRef<boolean>(true);
  const pendingTime = useRef<number | null>(null);
  const shouldPlay = useRef<boolean>(false);
  const arrivalTime = useRef(0);
  const [lesson, setLesson] = useState<LessonData | null>(null);
  const [partIndex, setPartIndex] = useState(0);
  const [filter, setFilter] = useState("");
  const [arrivalQuery] = useState(
    () => new URLSearchParams(window.location.search).get("q")?.trim() ?? ""
  );
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(-1);
  const deferredFilter = useDeferredValue(filter);

  useEffect(() => {
    if (!endpoint) {
      setError("تعذّر تشغيل الصوت الآن؛ التفريغ متاح أدناه.");
      return;
    }

    const controller = new AbortController();
    const seconds = Number(
      new URLSearchParams(window.location.search).get("t")
    );
    const start = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;

    fetch(`${endpoint}/lesson`, {
      body: JSON.stringify({ sourceId: id }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
    })
      .then(async (response) => {
        const value: unknown = await response.json();

        if (!(response.ok && isLesson(value))) {
          throw new Error("Lesson unavailable");
        }

        return value;
      })
      .then((found) => {
        const target = Math.min(start, Math.max(0, found.durationMs - 1));

        arrivalTime.current = target;
        pendingTime.current = target;
        shouldPlay.current = target > 0;
        setPartIndex(partAt(found.parts, target));
        setLesson(found);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("تعذّر تشغيل الصوت الآن؛ التفريغ متاح أدناه.");
        }
      });

    return () => controller.abort();
  }, [endpoint, id]);

  const setActiveAt = useCallback(
    (milliseconds: number) => {
      if (!lesson) {
        return;
      }

      const index = segmentAt(lesson.segments, milliseconds);

      if (index === active.current) {
        return;
      }

      const rows = list.current?.children;
      const previous = rows?.item(active.current);
      const current = rows?.item(index);

      previous?.classList.remove("cue-on");
      previous?.classList.add("cue-off");
      current?.classList.remove("cue-off");
      current?.classList.add("cue-on");
      active.current = index;

      if (
        !(follow.current && current instanceof HTMLElement && !current.hidden)
      ) {
        return;
      }

      list.current?.scrollTo({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        top:
          current.offsetTop -
          (list.current.clientHeight - current.clientHeight) / 2,
      });
    },
    [lesson]
  );

  useEffect(() => {
    if (!lesson) {
      return;
    }

    const transcript = document.getElementById(transcriptId);

    if (transcript) {
      transcript.hidden = true;
    }

    const frame = requestAnimationFrame(() => setActiveAt(arrivalTime.current));

    return () => cancelAnimationFrame(frame);
  }, [lesson, setActiveAt, transcriptId]);

  const current = lesson?.parts[partIndex] ?? null;

  useEffect(() => {
    const instance = player.current;

    if (!(instance && current)) {
      return;
    }

    return instance.subscribe(({ currentTime }) => {
      if (pendingTime.current === null) {
        setActiveAt(current.offsetMs + currentTime * 1000);
      }
    });
  }, [current, setActiveAt]);

  const playAt = (milliseconds: number) => {
    if (!(lesson && current)) {
      return;
    }

    const nextPart = partAt(lesson.parts, milliseconds);
    const url = new URL(window.location.href);

    url.searchParams.set("t", String(Math.floor(milliseconds / 1000)));
    window.history.replaceState(null, "", url);
    setActiveAt(milliseconds);

    if (nextPart === partIndex && player.current) {
      player.current.currentTime = Math.max(
        0,
        (milliseconds - current.offsetMs) / 1000
      );
      player.current.play().catch(() => undefined);
      return;
    }

    pendingTime.current = milliseconds;
    shouldPlay.current = true;
    setPartIndex(nextPart);
  };

  const handleCanPlay = () => {
    if (!(current && player.current && pendingTime.current !== null)) {
      return;
    }

    const target = pendingTime.current;

    if (partAt(lesson?.parts ?? [], target) !== partIndex) {
      return;
    }

    player.current.currentTime = Math.max(
      0,
      (target - current.offsetMs) / 1000
    );
    pendingTime.current = null;
    setActiveAt(target);

    if (shouldPlay.current) {
      shouldPlay.current = false;
      player.current.play().catch(() => undefined);
    }
  };

  const changePart = (next: number) => {
    const part = lesson?.parts[next];

    if (!part) {
      return;
    }

    pendingTime.current = part.offsetMs;
    shouldPlay.current = true;
    setPartIndex(next);
  };

  const changeFilter = (event: ChangeEvent<HTMLInputElement>) =>
    setFilter(event.target.value);

  const changeFollow = (event: ChangeEvent<HTMLInputElement>) => {
    follow.current = event.target.checked;
  };

  const playSegment = (event: MouseEvent<HTMLButtonElement>) => {
    playAt(Number(event.currentTarget.dataset.start));
  };

  const copy = async (event: MouseEvent<HTMLButtonElement>) => {
    const index = Number(event.currentTarget.dataset.index);
    const text = lesson?.segments[index]?.text;

    event.stopPropagation();
    if (!text) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
    } catch {
      setCopied(-1);
    }
  };

  const backToSearch = (event: MouseEvent<HTMLAnchorElement>) => {
    if (document.referrer.startsWith(`${window.location.origin}/`)) {
      event.preventDefault();
      window.history.back();
    }
  };

  if (error) {
    return (
      <p className="card mt-8 p-4 text-muted text-sm" role="status">
        {error}
      </p>
    );
  }

  const header = (
    <>
      <a
        className="inline-flex min-h-11 items-center text-muted text-sm hover:text-fg"
        href="/"
        onClick={backToSearch}
      >
        العودة إلى نتائج البحث
      </a>

      {arrivalQuery && (
        <p className="mt-3 inline-flex rounded-full bg-accent-soft px-3 py-1 text-accent text-sm">
          نتيجة البحث عن: {arrivalQuery}
        </p>
      )}

      <h1
        className="mt-3 font-semibold text-2xl leading-relaxed tracking-tight"
        data-vt-title
      >
        {title}
      </h1>
    </>
  );

  if (!(lesson && current)) {
    return null;
  }

  const normalizedFilter = normalizeArabic(deferredFilter);
  const matches = lesson.segments.map(
    (segment) =>
      !normalizedFilter ||
      normalizeArabic(segment.text).includes(normalizedFilter)
  );
  const resultCount = matches.filter(Boolean).length;

  return (
    <div className="pt-8 pb-36 lg:pb-0">
      {header}
      <p className="mt-1 flex flex-wrap items-center gap-x-4 text-muted text-sm">
        <span className="digits">{timestamp(lesson.durationMs)}</span>
        {lesson.url && (
          <a
            className="inline-flex min-h-11 items-center text-accent underline underline-offset-4"
            href={lesson.url}
            rel="noopener noreferrer"
            target="_blank"
          >
            افتح المصدر الأصلي
          </a>
        )}
      </p>

      <Actions
        body={lesson.segments
          .map((segment) => `[${timestamp(segment.startMs)}] ${segment.text}`)
          .join("\n")}
        href={lessonPath(id)}
        kind="v"
        title={lesson.title}
      />

      <div
        className="mt-6 grid items-start gap-6 lg:grid-cols-2 lg:gap-8"
        data-lesson-grid
      >
        <section
          aria-label="المشغل الصوتي"
          className="fixed inset-x-0 bottom-0 z-40 border-border border-t bg-bg/95 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgb(0_0_0/0.08)] backdrop-blur lg:sticky lg:top-20 lg:z-10 lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none"
          data-print-hide
        >
          <div className="mx-auto max-w-xl lg:mx-0 lg:max-w-none">
            <AudioPlayer
              index={partIndex}
              onCanPlay={handleCanPlay}
              onPart={changePart}
              parts={lesson.parts}
              playerRef={player}
              title={lesson.title}
            />
          </div>
        </section>

        <section aria-label="التفريغ" className="min-w-0">
          <div
            className="-mx-2 flex flex-wrap items-center gap-x-4 gap-y-2 bg-bg px-2 py-2 lg:sticky lg:top-14 lg:z-20"
            data-print-hide
          >
            <input
              aria-label="ابحث داخل الدرس"
              className="h-11 min-w-0 flex-1 rounded-lg border border-border-strong bg-surface px-3 text-sm placeholder:text-muted"
              data-search-input
              onChange={changeFilter}
              placeholder="ابحث داخل الدرس"
              type="search"
              value={filter}
            />
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-muted text-sm">
              <input
                className="size-4 accent-accent"
                defaultChecked
                onChange={changeFollow}
                type="checkbox"
              />
              متابعة تلقائية
            </label>
          </div>

          <p
            aria-live="polite"
            className="min-h-6 pt-1 text-muted text-sm"
            data-print-hide
          >
            {filter.trim() &&
              (resultCount > 0
                ? `النتائج: ${resultCount}`
                : "لا نتائج داخل التفريغ")}
          </p>

          <ol
            className="relative mt-1 h-[55dvh] overflow-y-auto overscroll-contain rounded-lg lg:h-[calc(100dvh-10rem)] lg:pe-1"
            id="cues"
            ref={list}
          >
            {lesson.segments.map((segment, index) => (
              <li
                className="group cue cue-off"
                data-segment={index}
                hidden={!matches[index]}
                key={`${segment.partOrder}-${segment.startMs}`}
              >
                <button
                  aria-label={`تشغيل من ${timestamp(segment.startMs)}`}
                  className="cue-ts"
                  data-start={segment.startMs}
                  onClick={playSegment}
                  type="button"
                >
                  <span className="digits">{timestamp(segment.startMs)}</span>
                </button>
                <button
                  aria-label={`تشغيل المقطع عند ${timestamp(segment.startMs)}`}
                  className="cue-txt text-start"
                  data-start={segment.startMs}
                  onClick={playSegment}
                  type="button"
                >
                  {highlightWords(segment.text, deferredFilter)}
                </button>
                <button
                  aria-label={`نسخ نص المقطع عند ${timestamp(segment.startMs)}`}
                  className="cue-copy"
                  data-index={index}
                  onClick={copy}
                  type="button"
                >
                  {copied === index ? (
                    <Check aria-hidden="true" className="size-4 text-accent" />
                  ) : (
                    <Copy aria-hidden="true" className="size-4" />
                  )}
                </button>
              </li>
            ))}
          </ol>
          <span aria-live="polite" className="sr-only">
            {copied >= 0 ? "تم نسخ نص المقطع" : ""}
          </span>
        </section>
      </div>
    </div>
  );
}
