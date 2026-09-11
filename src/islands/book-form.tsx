import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useState,
} from "react";
import type { Doc } from "../../convex/_generated/dataModel";

/** Every editable field of a book, shaped exactly as the mutations want it. */
export interface BookInput {
  categories: string[];
  date: string | null;
  description: string;
  downloadUrl: string | null;
  published: boolean;
  slug: string;
  sourceUrl: string | null;
  title: string;
}

interface FieldErrors {
  downloadUrl?: string;
  slug?: string;
  sourceUrl?: string;
  title?: string;
}

interface Props {
  book: Doc<"books"> | null;
  /** Error returned by the server, e.g. a duplicate slug. */
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: BookInput) => void;
  pending: boolean;
}

const FIELD =
  "mt-2 w-full rounded-xl border border-border-strong bg-surface px-4 py-3 text-base placeholder:text-muted";
const LABEL = "block font-medium text-sm";
const ERROR = "mt-1 block text-destructive text-sm";
const PRIMARY =
  "inline-flex min-h-11 items-center rounded-lg bg-accent px-4 font-medium text-accent-fg text-sm disabled:opacity-60";
const SECONDARY =
  "inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm transition-colors hover:bg-surface-2";
/** Both the Latin and the Arabic comma separate categories. */
const SEPARATOR = /[,،]/;

/** `true` only for an absolute http(s) URL. */
const isHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);

    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const trimmedOrNull = (value: string): string | null => {
  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
};

const toCategories = (value: string): string[] =>
  value
    .split(SEPARATOR)
    .map((category) => category.trim())
    .filter((category) => category.length > 0);

const validate = (values: {
  downloadUrl: string;
  slug: string;
  sourceUrl: string;
  title: string;
}): FieldErrors => {
  const errors: FieldErrors = {};

  if (values.slug.trim().length === 0) {
    errors.slug = "المُعرِّف مطلوب.";
  }

  if (values.title.trim().length === 0) {
    errors.title = "العنوان مطلوب.";
  }

  const sourceUrl = values.sourceUrl.trim();

  if (sourceUrl.length > 0 && !isHttpUrl(sourceUrl)) {
    errors.sourceUrl = "أدخل رابطًا كاملًا يبدأ بـ https://";
  }

  const downloadUrl = values.downloadUrl.trim();

  if (downloadUrl.length > 0 && !isHttpUrl(downloadUrl)) {
    errors.downloadUrl = "أدخل رابطًا كاملًا يبدأ بـ https://";
  }

  return errors;
};

interface TextFieldProps {
  dir?: "ltr";
  error?: string;
  hint?: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "date" | "text" | "url";
  value: string;
}

const TextField = ({
  dir,
  error,
  hint,
  id,
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: TextFieldProps): ReactNode => {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) =>
    onChange(event.target.value);

  return (
    <div>
      <label className={LABEL} htmlFor={id}>
        {label}
      </label>
      <input
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={error ? true : undefined}
        className={FIELD}
        dir={dir}
        id={id}
        onChange={handleChange}
        placeholder={placeholder}
        type={type}
        value={value}
      />
      {hint && !error && (
        <span className="mt-1 block text-muted text-sm">{hint}</span>
      )}
      {error && (
        <span className={ERROR} id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
};

/** One form for both creating and editing; mount it with a `key` per book. */
export const BookForm = ({
  book,
  error,
  onCancel,
  onSubmit,
  pending,
}: Props): ReactNode => {
  const [slug, setSlug] = useState(book?.slug ?? "");
  const [title, setTitle] = useState(book?.title ?? "");
  const [description, setDescription] = useState(book?.description ?? "");
  const [date, setDate] = useState(book?.date ?? "");
  const [categories, setCategories] = useState(
    book ? book.categories.join("، ") : ""
  );
  const [sourceUrl, setSourceUrl] = useState(book?.sourceUrl ?? "");
  const [downloadUrl, setDownloadUrl] = useState(book?.downloadUrl ?? "");
  const [published, setPublished] = useState(book?.published ?? false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const handleDescription = (event: ChangeEvent<HTMLTextAreaElement>) =>
    setDescription(event.target.value);

  const handlePublished = (event: ChangeEvent<HTMLInputElement>) =>
    setPublished(event.target.checked);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const found = validate({ downloadUrl, slug, sourceUrl, title });
    setErrors(found);

    if (Object.keys(found).length > 0) {
      return;
    }

    onSubmit({
      categories: toCategories(categories),
      date: trimmedOrNull(date),
      description: description.trim(),
      downloadUrl: trimmedOrNull(downloadUrl),
      published,
      slug: slug.trim(),
      sourceUrl: trimmedOrNull(sourceUrl),
      title: title.trim(),
    });
  };

  return (
    <form className="card mt-6 p-5" noValidate onSubmit={handleSubmit}>
      <h2 className="font-semibold text-lg">
        {book ? "تعديل كتاب" : "إضافة كتاب"}
      </h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <TextField
          error={errors.title}
          id="book-title"
          label="العنوان *"
          onChange={setTitle}
          value={title}
        />
        <TextField
          dir="ltr"
          error={errors.slug}
          hint="يظهر في الرابط، بحروف لاتينية وشرطات."
          id="book-slug"
          label="المُعرِّف *"
          onChange={setSlug}
          placeholder="kitab-al-tawhid"
          value={slug}
        />
        <TextField
          dir="ltr"
          id="book-date"
          label="التاريخ"
          onChange={setDate}
          type="date"
          value={date}
        />
        <TextField
          hint="افصل بين التصنيفات بفاصلة."
          id="book-categories"
          label="التصنيفات"
          onChange={setCategories}
          placeholder="عقيدة، فقه"
          value={categories}
        />
        <TextField
          dir="ltr"
          error={errors.sourceUrl}
          id="book-source-url"
          label="رابط المصدر"
          onChange={setSourceUrl}
          placeholder="https://"
          type="url"
          value={sourceUrl}
        />
        <TextField
          dir="ltr"
          error={errors.downloadUrl}
          id="book-download-url"
          label="رابط التنزيل"
          onChange={setDownloadUrl}
          placeholder="https://"
          type="url"
          value={downloadUrl}
        />
      </div>

      <div className="mt-4">
        <label className={LABEL} htmlFor="book-description">
          الوصف
        </label>
        <textarea
          className={FIELD}
          id="book-description"
          onChange={handleDescription}
          rows={4}
          value={description}
        />
      </div>

      <label
        className="mt-4 flex min-h-11 items-center gap-3 text-sm"
        htmlFor="book-published"
      >
        <input
          checked={published}
          className="size-5 accent-accent"
          id="book-published"
          onChange={handlePublished}
          type="checkbox"
        />
        منشور
      </label>

      {error && (
        <p className="mt-4 rounded-lg border border-destructive px-4 py-3 text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <button className={PRIMARY} disabled={pending} type="submit">
          {pending ? "جارٍ الحفظ…" : "حفظ"}
        </button>
        <button className={SECONDARY} onClick={onCancel} type="button">
          إلغاء
        </button>
      </div>
    </form>
  );
};
