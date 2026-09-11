/**
 * The lesson player. A lesson is N separate audio files, so this presents them
 * as one virtual timeline: `offsetMs` already defines where each part starts,
 * and the player advances to the next part on `ended`.
 *
 * Playback is Vidstack's `DefaultAudioLayout`, which brings speed control,
 * keyboard shortcuts, buffering and volume, plus Media Session metadata so the
 * lock screen and notification controls work while the tab is backgrounded.
 */

import {
  MediaPlayer,
  type MediaPlayerInstance,
  MediaProvider,
} from "@vidstack/react";
import {
  DefaultAudioLayout,
  defaultLayoutIcons,
} from "@vidstack/react/player/layouts/default";
import { useAction } from "convex/react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Banner, duration, errorMessage, ICON_BUTTON, num } from "./ui";

interface Part {
  durationMs: number;
  mimeType: string | null;
  offsetMs: number;
  order: number;
  partId: Id<"lessonParts">;
  url: string;
}

/**
 * Arabic labels for every word the audio layout can surface. Vidstack ships no
 * Arabic bundle, so an unlisted key falls back to English mid-menu.
 */
const TRANSLATIONS = {
  Accessibility: "إمكانية الوصول",
  Announcements: "الإعلانات الصوتية",
  Audio: "الصوت",
  Auto: "تلقائي",
  Boost: "تعزيز",
  "Caption Styles": "أنماط الترجمة",
  Captions: "الترجمة",
  Chapters: "الفصول",
  "Closed-Captions Off": "الترجمة معطّلة",
  "Closed-Captions On": "الترجمة مفعّلة",
  Color: "اللون",
  Continue: "متابعة",
  Default: "الافتراضي",
  Disabled: "معطّل",
  "Display Background": "خلفية العرض",
  Download: "تنزيل",
  Family: "الخط",
  Font: "الخط",
  "Keyboard Animations": "حركات الاختصارات",
  Loop: "تكرار",
  Mute: "كتم الصوت",
  Normal: "عادية",
  Off: "معطّل",
  Opacity: "الشفافية",
  Pause: "إيقاف مؤقّت",
  Play: "تشغيل",
  Playback: "التشغيل",
  Quality: "الجودة",
  Replay: "إعادة",
  Reset: "إعادة الضبط",
  Seek: "تقديم أو تأخير",
  "Seek Backward": "إرجاع",
  "Seek Forward": "تقديم",
  Settings: "الإعدادات",
  Shadow: "الظل",
  Size: "الحجم",
  Speed: "السرعة",
  Text: "النص",
  "Text Background": "خلفية النص",
  Track: "المسار",
  Unmute: "إلغاء الكتم",
  Volume: "مستوى الصوت",
};

const SPEEDS = { max: 3, min: 0.5, step: 0.25 };

/**
 * `captionButton`: no lesson has a caption track, so the toggle is inert.
 * `title`: the lesson's title is the heading directly above the player, and at
 * this column width the duplicate consumed the space the seek bar needs.
 */
const SLOTS = { captionButton: null, title: null };

/**
 * The layout's own default is `"system"`, which reads `prefers-color-scheme` —
 * but this site's theme is a `.dark` class the user toggles, so the player would
 * drift out of step with the page around it.
 */
const usePlayerTheme = (): "dark" | "light" => {
  const [dark, setDark] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() =>
      setDark(root.classList.contains("dark"))
    );

    observer.observe(root, { attributeFilter: ["class"], attributes: true });

    return () => observer.disconnect();
  }, []);

  return dark ? "dark" : "light";
};

export const LessonPlayer = ({
  lessonId,
  title,
  totalMs,
}: {
  lessonId: Id<"lessons">;
  title: string;
  totalMs: number;
}): ReactNode => {
  const lessonUrls = useAction(api.media.lessonUrls);
  const colorScheme = usePlayerTheme();
  const player = useRef<MediaPlayerInstance>(null);
  const [parts, setParts] = useState<Part[] | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Signed URLs are fetched per lesson, not per part: one round trip covers the
  // whole timeline, and the signature outlives any realistic listening session.
  useEffect(() => {
    let live = true;
    setParts(null);
    setIndex(0);
    setError(null);

    lessonUrls({ lessonId })
      .then((found) => {
        if (live) {
          setParts(found);
        }
      })
      .catch((caught: unknown) => {
        if (live) {
          setError(errorMessage(caught));
        }
      });

    return () => {
      live = false;
    };
  }, [lessonId, lessonUrls]);

  const current = parts?.[index] ?? null;

  /**
   * Vidstack publishes Media Session metadata and action handlers, but never
   * `setPositionState` — so without this the lock screen would show the current
   * part's length instead of the lesson's. Republishing on every tick keeps the
   * scrubber on the whole-lesson timeline.
   */
  useEffect(() => {
    const instance = player.current;

    if (!(instance && current && "mediaSession" in navigator)) {
      return;
    }

    return instance.subscribe(({ currentTime, playbackRate }) => {
      try {
        navigator.mediaSession.setPositionState({
          duration: totalMs / 1000,
          playbackRate: playbackRate || 1,
          position: Math.min(
            current.offsetMs / 1000 + currentTime,
            totalMs / 1000
          ),
        });
      } catch {
        // Safari throws when the position falls outside the reported duration.
      }
    });
  }, [current, totalMs]);

  if (error) {
    return <Banner>{error}</Banner>;
  }

  if (!(parts && current)) {
    return (
      <p className="flex items-center justify-center gap-2 rounded-xl border border-border border-dashed p-8 text-muted text-sm">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        جارٍ تجهيز الصوت…
      </p>
    );
  }

  const step = (delta: number) =>
    setIndex((at) => Math.min(Math.max(at + delta, 0), parts.length - 1));

  const handleEnded = () => step(1);
  const handlePrevious = () => step(-1);
  const handleNext = () => step(1);

  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      {/*
        The transport stays LTR: Vidstack's default layout is laid out with
        physical properties, and every platform player keeps media controls LTR
        even in an RTL locale. The Arabic labels come from `translations`.
      */}
      <div dir="ltr">
        <MediaPlayer
          artist={`الجزء ${current.order + 1} من ${parts.length}`}
          className="w-full"
          crossOrigin={null}
          key={current.partId}
          onEnded={handleEnded}
          playsInline
          ref={player}
          src={{
            src: current.url,
            type: (current.mimeType ?? "audio/mpeg") as "audio/mpeg",
          }}
          title={title}
          viewType="audio"
        >
          <MediaProvider />
          {/*
            The seek bar and the ±10s buttons are hidden while paused and slide
            in on play — that is the layout's own behaviour, not a missing
            control. `smallLayoutWhen` is left at its default so the layout still
            collapses on a phone.
          */}
          <DefaultAudioLayout
            colorScheme={colorScheme}
            icons={defaultLayoutIcons}
            playbackRates={SPEEDS}
            seekStep={10}
            slots={SLOTS}
            translations={TRANSLATIONS}
          />
        </MediaPlayer>
      </div>

      {parts.length > 1 && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            aria-label="الجزء السابق"
            className={ICON_BUTTON}
            disabled={index === 0}
            onClick={handlePrevious}
            type="button"
          >
            <ChevronRight aria-hidden="true" className="size-5" />
          </button>

          <p className="text-center text-muted text-xs">
            الجزء <span className="digits">{num(index + 1)}</span> من{" "}
            <span className="digits">{num(parts.length)}</span>
            {" · "}
            <span className="digits">{duration(current.durationMs)}</span>
            {" · يبدأ عند "}
            <span className="digits">{duration(current.offsetMs)}</span>
          </p>

          <button
            aria-label="الجزء التالي"
            className={ICON_BUTTON}
            disabled={index === parts.length - 1}
            onClick={handleNext}
            type="button"
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
};
