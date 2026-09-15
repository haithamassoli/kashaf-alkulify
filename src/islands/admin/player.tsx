/**
 * The dashboard's lesson player: fetches the lesson's signed part URLs, then
 * hands them to the shared `AudioPlayer`.
 */

import { useAction } from "convex/react";
import { Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AudioPlayer, type PlayerPart } from "../audio-player";
import { Banner, errorMessage } from "./ui";

export const LessonPlayer = ({
  lessonId,
  title,
}: {
  lessonId: Id<"lessons">;
  title: string;
}): ReactNode => {
  const lessonUrls = useAction(api.media.lessonUrls);
  const [parts, setParts] = useState<PlayerPart[] | null>(null);
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

  if (error) {
    return <Banner>{error}</Banner>;
  }

  if (!parts) {
    return (
      <p className="flex items-center justify-center gap-2 rounded-xl border border-border border-dashed p-8 text-muted text-sm">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        جارٍ تجهيز الصوت…
      </p>
    );
  }

  return (
    <AudioPlayer index={index} onPart={setIndex} parts={parts} title={title} />
  );
};
