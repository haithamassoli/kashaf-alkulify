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
