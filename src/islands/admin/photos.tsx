/** Photos posted to Telegram that no article shows, ready to be linked to one. */

import { useMutation, usePaginatedQuery } from "convex/react";
import { ExternalLink, Link2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ArticlePicker, Thumb, usePhotoUrls } from "./articles";
import {
  Banner,
  Chip,
  Empty,
  errorMessage,
  SECONDARY,
  Spinner,
  stamp,
} from "./ui";

const PAGE_SIZE = 24;

interface Photo {
  caption: string | null;
  date: number;
  isForwarded: boolean;
  mediaObjectId: Id<"mediaObjects">;
  telegramUrl: string;
}

const PhotoCard = ({
  busy,
  linking,
  onLink,
  onMode,
  photo,
  url,
}: {
  busy: boolean;
  linking: boolean;
  onLink: (photo: Photo, articleId: Id<"articles">) => void;
  onMode: (id: Id<"mediaObjects"> | null) => void;
  photo: Photo;
  url: string | undefined;
}): ReactNode => {
  const handleOpen = () => onMode(photo.mediaObjectId);
  const handleCancel = () => onMode(null);
  const handlePick = (articleId: Id<"articles">) => onLink(photo, articleId);

  return (
    <li className={`card p-3 ${linking ? "sm:col-span-2" : ""}`}>
      <div className={linking ? "max-w-48" : ""}>
        <Thumb url={url} />
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-muted text-xs">
        <span className="digits">{stamp(photo.date)}</span>
        {photo.isForwarded && <Chip>محوّلة</Chip>}
        <a
          aria-label="فتح في تيليجرام"
          className="text-muted hover:text-accent"
          href={photo.telegramUrl}
          rel="noopener"
          target="_blank"
        >
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </a>
      </p>
      {photo.caption && (
        <p className="mt-1 line-clamp-2 text-sm leading-6">{photo.caption}</p>
      )}
      {linking ? (
        <ArticlePicker
          busy={busy}
          label="اربط الصورة بمقالة"
          onCancel={handleCancel}
          onPick={handlePick}
        />
      ) : (
        <button
          className={`${SECONDARY} mt-2 w-full`}
          onClick={handleOpen}
          type="button"
        >
          <Link2 aria-hidden="true" className="size-4" />
          ربط بمقالة
        </button>
      )}
    </li>
  );
};

export const Photos = (): ReactNode => {
  const { isLoading, loadMore, results, status } = usePaginatedQuery(
    api.admin.unlinkedPhotos,
    {},
    { initialNumItems: PAGE_SIZE }
  );
  const setArticlePhoto = useMutation(api.admin.setArticlePhoto);
  const urls = usePhotoUrls(results.map((photo) => photo.mediaObjectId));
  const [linking, setLinking] = useState<Id<"mediaObjects"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleMore = () => loadMore(PAGE_SIZE);
  const handleLink = async (photo: Photo, articleId: Id<"articles">) => {
    setBusy(true);
    setError(null);

    try {
      await setArticlePhoto({
        id: articleId,
        linked: true,
        mediaObjectId: photo.mediaObjectId,
      });
      setLinking(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pb-8">
      <p className="text-muted text-sm">
        صور نُشرت في القنوات ولا تظهر في أي مقالة، الأحدث أولًا.
      </p>

      {error && <Banner>{error}</Banner>}

      {status === "LoadingFirstPage" && <Spinner label="جارٍ التحميل…" />}

      {status === "Exhausted" && results.length === 0 && (
        <Empty>كل الصور مرتبطة بمقالات.</Empty>
      )}

      <ul className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {results.map((photo) => (
          <PhotoCard
            busy={busy}
            key={photo.mediaObjectId}
            linking={linking === photo.mediaObjectId}
            onLink={handleLink}
            onMode={setLinking}
            photo={photo}
            url={urls[photo.mediaObjectId]}
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
  );
};
