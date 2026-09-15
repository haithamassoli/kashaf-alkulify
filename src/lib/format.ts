/** ISO date -> Arabic-labelled Gregorian date with Western digits. */
const DATE = new Intl.DateTimeFormat("ar-u-nu-latn", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

export const arabicDate = (iso: string | null | undefined): string => {
  if (!iso) {
    return "";
  }

  const date = new Date(`${iso}T00:00:00Z`);

  return Number.isNaN(date.getTime()) ? "" : DATE.format(date);
};

const number = (value: number) => value.toLocaleString("en-US");

/** Milliseconds -> `m:ss`, or `h:mm:ss` from the first hour. */
export const timestamp = (milliseconds: number): string => {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
};

/** Milliseconds -> «ساعة و١٥ دقيقة» with Western digits. */
export const duration = (milliseconds: number): string => {
  const minutes = Math.round(milliseconds / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) {
    return `${number(rest)} دقيقة`;
  }

  return rest === 0
    ? `${number(hours)} ساعة`
    : `${number(hours)} ساعة و${number(rest)} دقيقة`;
};

const DAY = new Intl.DateTimeFormat("ar-u-nu-latn", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** Epoch milliseconds -> Arabic-labelled Gregorian date with Western digits. */
export const arabicDay = (milliseconds: number): string =>
  DAY.format(new Date(milliseconds));
