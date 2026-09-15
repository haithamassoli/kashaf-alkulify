import { Bookmark, Copy, FileText, Printer, Share2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { type SavedKind, savedItems, setSaved } from "../lib/saved";
import { flash } from "../lib/toast";

interface Props {
  /** The text to copy, or the id of the element holding it (keeps long text out of island props). */
  body: string | { from: string };
  href: string;
  kind: SavedKind;
  title: string;
}

const ACTION =
  "inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-muted transition-colors hover:text-fg";
const ICON = "size-5";

export const Actions = ({ body, href, kind, title }: Props): ReactNode => {
  const [saved, setSavedState] = useState(false);
  const absoluteUrl = () => new URL(href, window.location.origin).href;
  const text = () =>
    typeof body === "string"
      ? body
      : (document.getElementById(body.from)?.textContent ?? "");
  const documentText = () => `${title}\n${absoluteUrl()}\n\n${text()}\n`;

  useEffect(() => {
    setSavedState(Boolean(savedItems()[href]));
  }, [href]);

  const toggleSaved = () => {
    const next = !saved;

    setSaved(href, next ? { kind, title } : undefined);
    setSavedState(next);
    flash(next ? "أُضيف إلى المحفوظات" : "أُزيل من المحفوظات");
  };

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title, url: absoluteUrl() });
        return;
      }

      await navigator.clipboard.writeText(absoluteUrl());
      flash("تم نسخ الرابط");
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        flash("تعذّرت المشاركة");
      }
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(documentText());
      flash("تم نسخ النص");
    } catch {
      flash("تعذّر النسخ");
    }
  };

  const downloadText = () => {
    const url = URL.createObjectURL(
      new Blob([documentText()], { type: "text/plain;charset=utf-8" })
    );
    const link = Object.assign(document.createElement("a"), {
      download: `${title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80)}.txt`,
      href: url,
    });

    link.click();
    URL.revokeObjectURL(url);
  };
  const print = () => window.print();

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 print:hidden">
      <button
        aria-label={saved ? "أزل من المحفوظات" : "احفظ في المحفوظات"}
        aria-pressed={saved}
        className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-surface text-muted transition-colors hover:text-fg aria-pressed:text-accent"
        onClick={toggleSaved}
        title={saved ? "أزل من المحفوظات" : "احفظ في المحفوظات"}
        type="button"
      >
        <Bookmark
          aria-hidden="true"
          className={ICON}
          fill={saved ? "currentColor" : "none"}
        />
      </button>
      <button className={ACTION} onClick={share} type="button">
        <Share2 aria-hidden="true" className={ICON} />
        مشاركة
      </button>
      <button className={ACTION} onClick={copy} type="button">
        <Copy aria-hidden="true" className={ICON} />
        نسخ الكل
      </button>
      <button className={ACTION} onClick={print} type="button">
        <Printer aria-hidden="true" className={ICON} />
        PDF
      </button>
      <button className={ACTION} onClick={downloadText} type="button">
        <FileText aria-hidden="true" className={ICON} />
        TXT
      </button>
    </div>
  );
};
