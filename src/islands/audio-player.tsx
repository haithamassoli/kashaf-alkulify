/**
 * The one lesson player, shared by the public lesson page and the dashboard.
 * A lesson is N separate audio files, so this presents them as one virtual
 * timeline: `offsetMs` already defines where each part starts, and the owner
 * decides what happens on a part change through `onPart`.
 *
 * Playback is Vidstack's `DefaultAudioLayout`, which brings speed control,
 * keyboard shortcuts, buffering and volume, plus Media Session metadata so the
 * lock screen and notification controls work while the tab is backgrounded.
 * Its look is themed from the site tokens by `.player` in `global.css`.
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
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { timestamp } from "../lib/format";

/** Arabic labels for every word Vidstack's audio layout can surface. */
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
const SLOTS = { captionButton: null, title: null };

/** Part strip fill for parts before, at, and after the current one. */
const SEGMENT = [
  "bg-accent/45",
  "bg-accent",
  "bg-border group-hover:bg-muted/50",
];

const NAV_BUTTON =
  "grid size-11 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-30";

/** Keep Vidstack aligned with the site's class-based theme toggle. */
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

export interface PlayerPart {
  durationMs: number;
  mimeType?: string | null;
  offsetMs: number;
  url: string;
}

interface Props {
  index: number;
  onCanPlay?: () => void;
  /** Called with the part to switch to: navigation, the part strip, or `ended`. */
  onPart: (index: number) => void;
  parts: PlayerPart[];
  playerRef?: RefObject<MediaPlayerInstance | null>;
  title: string;
}

export const AudioPlayer = ({
  index,
  onCanPlay,
  onPart,
  parts,
  playerRef,
  title,
}: Props): ReactNode => {
  const colorScheme = usePlayerTheme();
  const ownRef = useRef<MediaPlayerInstance>(null);
  const player = playerRef ?? ownRef;
  const current = parts[index];
  const last = parts.at(-1);
  const totalMs = last ? last.offsetMs + last.durationMs : 0;

  /**
   * Vidstack publishes Media Session metadata and action handlers, but never
   * `setPositionState` — so without this the lock screen would show the current
   * part's length instead of the lesson's.
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
  }, [current, player, totalMs]);

  if (!current) {
    return null;
  }

  const handleEnded = () => {
    if (index < parts.length - 1) {
      onPart(index + 1);
    }
  };
  const handlePrevious = () => onPart(index - 1);
  const handleNext = () => onPart(index + 1);
  const handlePick = (event: MouseEvent<HTMLButtonElement>) =>
    onPart(Number(event.currentTarget.dataset.part));

  return (
    <div className="player rounded-xl border border-border bg-surface p-1.5 sm:p-2">
      {/*
        The transport stays LTR: Vidstack's default layout is laid out with
        physical properties, and every platform player keeps media controls LTR
        even in an RTL locale. The Arabic labels come from `translations`.
      */}
      <div dir="ltr">
        <MediaPlayer
          artist={`الجزء ${index + 1} من ${parts.length}`}
          className="w-full"
          crossOrigin={null}
          key={current.url}
          onCanPlay={onCanPlay}
          onEnded={handleEnded}
          playsInline
          preload="metadata"
          ref={player}
          src={
            current.mimeType
              ? { src: current.url, type: current.mimeType as "audio/mpeg" }
              : current.url
          }
          title={title}
          viewType="audio"
        >
          <MediaProvider />
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
        // The part strip is a timeline too, so it runs the same way as the seek bar.
        <div
          className="mt-1 flex items-center gap-1 border-border border-t pt-1.5"
          dir="ltr"
        >
          <button
            aria-label="الجزء السابق"
            className={NAV_BUTTON}
            disabled={index === 0}
            onClick={handlePrevious}
            type="button"
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </button>

          <div className="min-w-0 flex-1">
            <p
              className="flex items-baseline justify-between gap-2 px-1 text-xs"
              dir="rtl"
            >
              <span className="font-medium">
                الجزء <span className="digits">{index + 1}</span> من{" "}
                <span className="digits">{parts.length}</span>
              </span>
              <span className="digits text-muted">
                {timestamp(current.offsetMs)} –{" "}
                {timestamp(current.offsetMs + current.durationMs)}
              </span>
            </p>

            {/* Each part's width is its share of the lesson, in reading order. */}
            <div className="flex gap-0.5">
              {parts.map((part, at) => (
                <button
                  aria-current={at === index ? "true" : undefined}
                  aria-label={`الجزء ${at + 1} يبدأ عند ${timestamp(part.offsetMs)}`}
                  className="group flex min-w-2 py-2"
                  data-part={at}
                  key={part.url}
                  onClick={handlePick}
                  style={{ flexGrow: part.durationMs }}
                  type="button"
                >
                  <span
                    className={`h-1.5 w-full rounded-full transition-colors ${SEGMENT[Math.sign(at - index) + 1]}`}
                  />
                </button>
              ))}
            </div>
          </div>

          <button
            aria-label="الجزء التالي"
            className={NAV_BUTTON}
            disabled={index === parts.length - 1}
            onClick={handleNext}
            type="button"
          >
            <ChevronRight aria-hidden="true" className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
};
