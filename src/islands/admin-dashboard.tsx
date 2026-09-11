import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import {
  ConvexReactClient,
  useMutation,
  useQuery_experimental as useQuery,
} from "convex/react";
import { ConvexError } from "convex/values";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useState,
} from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { authClient } from "../lib/auth-client";
import { BookForm, type BookInput } from "./book-form";

const PRIMARY =
  "inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 font-medium text-accent-fg text-sm";
const SECONDARY =
  "inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm transition-colors hover:bg-surface-2";
const DANGER =
  "inline-flex min-h-11 items-center rounded-lg border border-destructive px-3 text-destructive text-sm transition-colors hover:bg-surface-2";
const ICON_BUTTON =
  "grid size-11 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-40";
const FIELD =
  "mt-2 w-full rounded-xl border border-border-strong bg-surface px-4 py-3 text-base placeholder:text-muted";
const CELL = "border-border border-t py-3 pe-3 align-middle";
const BANNER =
  "mt-4 rounded-lg border border-destructive px-4 py-3 text-destructive text-sm";

const convexUrl: string | undefined = import.meta.env.PUBLIC_CONVEX_URL;
// `expectAuth` holds every query until the Better Auth token is attached, so an
// admin-only query is never fired as an anonymous caller first.
const convex = convexUrl
  ? new ConvexReactClient(convexUrl, { expectAuth: true })
  : null;

/**
 * `@convex-dev/better-auth@0.12.5` types the provider's `authClient` prop so
 * that `useSession().data` resolves to `never` under `better-auth@1.6.15` — no
 * real client satisfies it. The runtime contract is unchanged, so the prop is
 * re-declared here against the client actually passed in.
 */
const AuthProvider = ConvexBetterAuthProvider as unknown as (props: {
  authClient: typeof authClient;
  children: ReactNode;
  client: ConvexReactClient;
}) => ReactNode;

/** Arabic-friendly copy for whatever a Convex function threw. */
/**
 * Server errors carry `{ code, message }` so the UI branches on the code rather
 * than on the prose — see `convex/lib/auth.ts`.
 */
const errorData = (
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

const errorCode = (error: unknown): string | undefined =>
  errorData(error)?.code;

const errorMessage = (error: unknown): string => {
  const data = errorData(error);

  if (data?.message) {
    return data.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "حدث خطأ غير متوقع.";
};

const SIGN_IN_ERRORS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  USER_NOT_FOUND: "لا يوجد حساب بهذا البريد الإلكتروني.",
};

const signInMessage = (code?: string, message?: string): string => {
  const known = code ? SIGN_IN_ERRORS[code] : undefined;

  return known ?? message ?? "تعذّر تسجيل الدخول. حاول مرة أخرى.";
};

const signOut = () => {
  authClient.signOut();
};

const SignInCard = (): ReactNode => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleEmail = (event: ChangeEvent<HTMLInputElement>) =>
    setEmail(event.target.value);

  const handlePassword = (event: ChangeEvent<HTMLInputElement>) =>
    setPassword(event.target.value);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    const result = await authClient.signIn.email({ email, password });

    setPending(false);

    if (result.error) {
      setError(signInMessage(result.error.code, result.error.message));
    }
  };

  return (
    <div className="mx-auto mt-16 w-full max-w-sm">
      <h1 className="text-center font-semibold text-2xl tracking-tight">
        لوحة التحكم
      </h1>
      <form className="card mt-6 p-5" noValidate onSubmit={handleSubmit}>
        <div>
          <label className="block font-medium text-sm" htmlFor="sign-in-email">
            البريد الإلكتروني
          </label>
          <input
            autoComplete="email"
            className={FIELD}
            dir="ltr"
            id="sign-in-email"
            onChange={handleEmail}
            required
            type="email"
            value={email}
          />
        </div>

        <div className="mt-4">
          <label
            className="block font-medium text-sm"
            htmlFor="sign-in-password"
          >
            كلمة المرور
          </label>
          <input
            autoComplete="current-password"
            className={FIELD}
            dir="ltr"
            id="sign-in-password"
            onChange={handlePassword}
            required
            type="password"
            value={password}
          />
        </div>

        <p aria-live="polite" className="mt-3 min-h-5 text-destructive text-sm">
          {error}
        </p>

        <button
          className={`${PRIMARY} mt-2 w-full justify-center disabled:opacity-60`}
          disabled={pending}
          type="submit"
        >
          {pending ? "جارٍ الدخول…" : "تسجيل الدخول"}
        </button>
      </form>
    </div>
  );
};

const Header = ({ email }: { email: string }): ReactNode => (
  <header className="mt-10 flex flex-wrap items-center justify-between gap-3">
    <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">
      لوحة التحكم
    </h1>
    <div className="flex items-center gap-3">
      <span className="text-muted text-sm" dir="ltr">
        {email}
      </span>
      <button className={SECONDARY} onClick={signOut} type="button">
        تسجيل الخروج
      </button>
    </div>
  </header>
);

/**
 * `books.listAll` throws for a signed-in user who is not on the `ADMIN_EMAILS`
 * allowlist; that case gets its own copy, anything else stays generic.
 */
const LoadFailure = ({
  email,
  error,
}: {
  email: string;
  error: Error;
}): ReactNode => {
  const message = errorMessage(error);
  const forbidden = errorCode(error) === "FORBIDDEN";

  return (
    <section className="card mt-6 p-5">
      <h2 className="font-semibold text-lg">
        {forbidden ? "ليس لديك صلاحية الوصول" : "تعذّر تحميل الكتب"}
      </h2>
      <p className="mt-2 text-muted leading-8">
        {forbidden
          ? `الحساب ${email} ليس ضمن قائمة المشرفين. سجّل الخروج ثم ادخل بحساب مشرف.`
          : "حدث خطأ أثناء جلب البيانات من الخادم."}
      </p>
      {forbidden ? null : (
        <p className="mt-2 break-words text-muted text-sm">{message}</p>
      )}
      <button className={`${SECONDARY} mt-4`} onClick={signOut} type="button">
        تسجيل الخروج
      </button>
    </section>
  );
};

const IconButton = ({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}): ReactNode => (
  <button
    aria-label={label}
    className={ICON_BUTTON}
    disabled={disabled}
    onClick={onClick}
    title={label}
    type="button"
  >
    {children}
  </button>
);

const StateChip = ({ published }: { published: boolean }): ReactNode =>
  published ? (
    <span className="inline-flex items-center rounded-lg bg-accent-soft px-2 py-1 text-accent text-xs">
      منشور
    </span>
  ) : (
    <span className="inline-flex items-center rounded-lg bg-surface-2 px-2 py-1 text-muted text-xs">
      مسودة
    </span>
  );

interface RowHandlers {
  onCancelDelete: () => void;
  onDelete: (book: Doc<"books">) => void;
  onEdit: (book: Doc<"books">) => void;
  onMove: (index: number, delta: number) => void;
  onToggle: (book: Doc<"books">) => void;
}

interface RowProps {
  book: Doc<"books">;
  confirming: boolean;
  handlers: RowHandlers;
  index: number;
  total: number;
}

const RowActions = ({
  book,
  confirming,
  handlers,
  index,
  total,
}: RowProps): ReactNode => {
  const handleDelete = () => handlers.onDelete(book);
  const handleEdit = () => handlers.onEdit(book);
  const handleToggle = () => handlers.onToggle(book);
  const handleUp = () => handlers.onMove(index, -1);
  const handleDown = () => handlers.onMove(index, 1);

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-muted text-sm">هل تحذف «{book.title}»؟</span>
        <button className={DANGER} onClick={handleDelete} type="button">
          تأكيد الحذف
        </button>
        <button
          className={SECONDARY}
          onClick={handlers.onCancelDelete}
          type="button"
        >
          إلغاء
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <IconButton
        label={book.published ? "إلغاء النشر" : "نشر"}
        onClick={handleToggle}
      >
        {book.published ? <Eye /> : <EyeOff />}
      </IconButton>
      <IconButton label="تعديل" onClick={handleEdit}>
        <Pencil />
      </IconButton>
      <IconButton disabled={index === 0} label="تحريك لأعلى" onClick={handleUp}>
        <ChevronUp />
      </IconButton>
      <IconButton
        disabled={index === total - 1}
        label="تحريك لأسفل"
        onClick={handleDown}
      >
        <ChevronDown />
      </IconButton>
      <IconButton label="حذف" onClick={handleDelete}>
        <Trash2 />
      </IconButton>
    </div>
  );
};

const BooksManager = ({ books: loaded }: { books: Doc<"books">[] }) => {
  const create = useMutation(api.books.create);
  const update = useMutation(api.books.update);
  const remove = useMutation(api.books.remove);
  const reorder = useMutation(api.books.reorder);

  const [editing, setEditing] = useState<Doc<"books"> | "new" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingId, setConfirmingId] = useState<Id<"books"> | null>(null);

  const books = [...loaded].sort((a, b) => a.order - b.order);

  const run = async (action: () => Promise<unknown>) => {
    setActionError(null);

    try {
      await action();
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  };

  const handleAdd = () => {
    setFormError(null);
    setEditing("new");
  };

  const handleCancel = () => setEditing(null);

  const handleSubmit = async (values: BookInput) => {
    setSaving(true);
    setFormError(null);

    try {
      if (editing && editing !== "new") {
        await update({ id: editing._id, ...values });
      } else {
        await create(values);
      }

      setEditing(null);
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const handlers: RowHandlers = {
    onCancelDelete: () => setConfirmingId(null),
    // First click arms the row, second click deletes.
    onDelete: (book) => {
      if (confirmingId !== book._id) {
        setConfirmingId(book._id);
        return;
      }

      setConfirmingId(null);
      run(() => remove({ id: book._id }));
    },
    onEdit: (book) => {
      setFormError(null);
      setEditing(book);
    },
    onMove: (index, delta) => {
      const target = index + delta;
      const next = [...books];
      const current = next[index];
      const swapped = next[target];

      if (!(current && swapped)) {
        return;
      }

      next[index] = swapped;
      next[target] = current;
      run(() => reorder({ ids: next.map((book) => book._id) }));
    },
    onToggle: (book) =>
      run(() => update({ id: book._id, published: !book.published })),
  };

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted text-sm">
          <span className="digits">{books.length}</span> كتابًا
        </p>
        <button className={PRIMARY} onClick={handleAdd} type="button">
          <Plus aria-hidden="true" className="size-4" />
          إضافة كتاب
        </button>
      </div>

      {actionError && <p className={BANNER}>{actionError}</p>}

      {editing && (
        <BookForm
          book={editing === "new" ? null : editing}
          error={formError}
          key={editing === "new" ? "new" : editing._id}
          onCancel={handleCancel}
          onSubmit={handleSubmit}
          pending={saving}
        />
      )}

      {books.length === 0 && (
        <p className="card mt-6 p-5 text-muted">لا توجد كتب بعد.</p>
      )}

      <table className="mt-6 hidden w-full text-sm sm:table">
        <thead className="text-muted text-xs">
          <tr>
            <th className="pb-2 text-start font-medium" scope="col">
              العنوان
            </th>
            <th className="pb-2 text-start font-medium" scope="col">
              المُعرِّف
            </th>
            <th className="pb-2 text-start font-medium" scope="col">
              التاريخ
            </th>
            <th className="pb-2 text-start font-medium" scope="col">
              الحالة
            </th>
            <th className="pb-2 text-end font-medium" scope="col">
              إجراءات
            </th>
          </tr>
        </thead>
        <tbody>
          {books.map((book, index) => (
            <tr className={book.published ? "" : "text-muted"} key={book._id}>
              <td className={`${CELL} font-medium`}>{book.title}</td>
              <td className={CELL}>
                <span className="text-muted text-xs" dir="ltr">
                  {book.slug}
                </span>
              </td>
              <td className={CELL}>
                <span className="digits text-xs">{book.date ?? "—"}</span>
              </td>
              <td className={CELL}>
                <StateChip published={book.published} />
              </td>
              <td className={`${CELL} pe-0`}>
                <RowActions
                  book={book}
                  confirming={confirmingId === book._id}
                  handlers={handlers}
                  index={index}
                  total={books.length}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="mt-6 space-y-3 sm:hidden">
        {books.map((book, index) => (
          <li
            className={`card p-4 ${book.published ? "" : "text-muted"}`}
            key={book._id}
          >
            <h2 className="font-medium">{book.title}</h2>
            <p className="mt-1 text-muted text-xs" dir="ltr">
              {book.slug}
            </p>
            <p className="mt-2 flex items-center gap-2">
              <StateChip published={book.published} />
              <span className="digits text-muted text-xs">
                {book.date ?? "—"}
              </span>
            </p>
            <div className="mt-2">
              <RowActions
                book={book}
                confirming={confirmingId === book._id}
                handlers={handlers}
                index={index}
                total={books.length}
              />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
};

const Dashboard = ({ email }: { email: string }): ReactNode => {
  const state = useQuery({ args: {}, query: api.books.listAll });

  return (
    <div className="pb-10">
      <Header email={email} />
      {state.status === "pending" && (
        <p className="mt-6 text-muted">جارٍ التحميل…</p>
      )}
      {state.status === "error" && (
        <LoadFailure email={email} error={state.error} />
      )}
      {state.status === "success" && <BooksManager books={state.data} />}
    </div>
  );
};

const AuthGate = (): ReactNode => {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <p className="mt-16 text-center text-muted">جارٍ التحقق…</p>;
  }

  if (!session) {
    return <SignInCard />;
  }

  return <Dashboard email={session.user.email} />;
};

const AdminDashboard = (): ReactNode => {
  if (!convex) {
    return (
      <p className="mt-16 text-center text-destructive">
        متغيّر PUBLIC_CONVEX_URL غير مضبوط.
      </p>
    );
  }

  return (
    <AuthProvider authClient={authClient} client={convex}>
      <AuthGate />
    </AuthProvider>
  );
};

export default AdminDashboard;
