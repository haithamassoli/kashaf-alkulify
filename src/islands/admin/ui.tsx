/** The dashboard's shared primitives: class strings, chips, tiles, formatters. */

import { ConvexError } from "convex/values";
import type { ReactNode } from "react";

export const PRIMARY =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 font-medium text-accent-fg text-sm transition-opacity hover:opacity-90 disabled:opacity-60";
export const SECONDARY =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50";
export const DANGER =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-destructive px-3 text-destructive text-sm transition-colors hover:bg-destructive/10";
export const ICON_BUTTON =
  "grid size-10 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-40";
export const FIELD =
  "w-full rounded-xl border border-border-strong bg-surface px-4 py-2.5 text-base placeholder:text-muted";

/** Tone drives every status colour in the dashboard — one scale, four steps. */
export type Tone = "accent" | "muted" | "warn" | "danger";

const TONE_CHIP: Record<Tone, string> = {
  accent: "bg-accent-soft text-accent",
  danger: "bg-destructive/10 text-destructive",
  muted: "bg-surface-2 text-muted",
  warn: "bg-mark-bg/40 text-mark-fg dark:text-mark-bg",
};

const TONE_DOT: Record<Tone, string> = {
  accent: "bg-accent",
  danger: "bg-destructive",
  muted: "bg-muted",
  warn: "bg-mark-bg",
};

export const Chip = ({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: Tone;
}): ReactNode => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ${TONE_CHIP[tone]}`}
  >
    {children}
  </span>
);

export const Dot = ({ tone }: { tone: Tone }): ReactNode => (
  <span
    aria-hidden="true"
    className={`inline-block size-2 shrink-0 rounded-full ${TONE_DOT[tone]}`}
  />
);

export const Section = ({
  action,
  children,
  description,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  title: string;
}): ReactNode => (
  <section className="mt-8 first:mt-0">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-semibold text-lg tracking-tight">{title}</h2>
        {description && (
          <p className="mt-1 text-muted text-sm">{description}</p>
        )}
      </div>
      {action}
    </div>
    <div className="mt-4">{children}</div>
  </section>
);

/** A headline number. `hint` carries the unit or the denominator. */
export const Tile = ({
  hint,
  label,
  tone = "muted",
  value,
}: {
  hint?: string;
  label: string;
  tone?: Tone;
  value: string;
}): ReactNode => (
  <div className="card p-4">
    <p className="flex items-center gap-2 text-muted text-xs">
      <Dot tone={tone} />
      {label}
    </p>
    <p className="digits mt-2 font-semibold text-2xl tracking-tight">{value}</p>
    {hint && <p className="mt-1 text-muted text-xs">{hint}</p>}
  </div>
);

export const Empty = ({ children }: { children: ReactNode }): ReactNode => (
  <p className="card p-6 text-center text-muted text-sm">{children}</p>
);

export const Spinner = ({ label }: { label: string }): ReactNode => (
  <p aria-live="polite" className="p-6 text-center text-muted text-sm">
    {label}
  </p>
);

// ── formatters ───────────────────────────────────────────────────────────────

const NUMBER = new Intl.NumberFormat("en-US");

export const num = (value: number): string => NUMBER.format(value);

/** A capped count reads as "12,000+" so the cap is never mistaken for a total. */
export const count = (value: { capped: boolean; count: number }): string =>
  `${num(value.count)}${value.capped ? "+" : ""}`;

const DATE_TIME = new Intl.DateTimeFormat("ar-u-nu-latn", {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
  year: "numeric",
});

export const stamp = (ms: number | null): string =>
  ms === null ? "—" : DATE_TIME.format(new Date(ms));

const RELATIVE = new Intl.RelativeTimeFormat("ar", { numeric: "auto" });

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "قبل ٣ ساعات". `now` is passed in so callers share one clock per render. */
export const ago = (ms: number | null, now: number): string => {
  if (ms === null) {
    return "—";
  }

  const elapsed = now - ms;

  if (elapsed < MINUTE) {
    return RELATIVE.format(-Math.round(elapsed / SECOND), "second");
  }

  if (elapsed < HOUR) {
    return RELATIVE.format(-Math.round(elapsed / MINUTE), "minute");
  }

  if (elapsed < DAY) {
    return RELATIVE.format(-Math.round(elapsed / HOUR), "hour");
  }

  return RELATIVE.format(-Math.round(elapsed / DAY), "day");
};

/** `h:mm:ss`, or `m:ss` under an hour. Always Western digits, always LTR. */
export const duration = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
};

export const bytes = (value: number): string => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size.toFixed(size < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
};

/** Arabic-friendly copy for whatever a Convex function threw. */
export const errorData = (
  error: unknown
): { code?: string; message?: string } | null => {
  if (!(error instanceof ConvexError)) {
    return null;
  }

  const { data } = error;

  if (typeof data === "string") {
    return { message: data };
  }

  if (typeof data === "object" && data !== null) {
    const { code, message } = data as { code?: unknown; message?: unknown };

    return {
      code: typeof code === "string" ? code : undefined,
      message: typeof message === "string" ? message : undefined,
    };
  }

  return null;
};

export const errorCode = (error: unknown): string | undefined =>
  errorData(error)?.code;

export const errorMessage = (error: unknown): string => {
  const data = errorData(error);

  if (data?.message) {
    return data.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "حدث خطأ غير متوقع.";
};

export const Banner = ({ children }: { children: ReactNode }): ReactNode => (
  <p className="mt-4 rounded-lg border border-destructive px-4 py-3 text-destructive text-sm">
    {children}
  </p>
);
