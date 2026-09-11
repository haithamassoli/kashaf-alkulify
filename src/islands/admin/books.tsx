/** The books manager: create, edit, publish, reorder, delete. */

import { useMutation, useQuery_experimental as useQuery } from "convex/react";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { BookForm, type BookInput } from "../book-form";
import {
  Banner,
  Chip,
  DANGER,
  Empty,
  errorCode,
  errorMessage,
  ICON_BUTTON,
  num,
  PRIMARY,
  SECONDARY,
  Spinner,
} from "./ui";

const CELL = "border-border border-t py-3 pe-3 align-middle";

const StateChip = ({ published }: { published: boolean }): ReactNode => (
  <Chip tone={published ? "accent" : "muted"}>
    {published ? "منشور" : "مسودة"}
  </Chip>
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

const Manager = ({ books: loaded }: { books: Doc<"books">[] }): ReactNode => {
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

  const handleAdd = () => {
    setFormError(null);
    setEditing("new");
  };

  const handleCancel = () => setEditing(null);

  const run = async (action: () => Promise<unknown>) => {
    setActionError(null);

    try {
      await action();
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  };

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
    <div className="pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted text-sm">
          الكتب: <span className="digits">{num(books.length)}</span> · المنشور:{" "}
          <span className="digits">
            {num(books.filter((book) => book.published).length)}
          </span>
        </p>
        <button className={PRIMARY} onClick={handleAdd} type="button">
          <Plus aria-hidden="true" className="size-4" />
          إضافة كتاب
        </button>
      </div>

      {actionError && <Banner>{actionError}</Banner>}

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

      {books.length === 0 && <Empty>لا توجد كتب بعد.</Empty>}

      <table className="mt-6 hidden w-full text-sm sm:table">
        <thead className="text-muted text-xs">
          <tr>
            {["العنوان", "المُعرِّف", "التاريخ", "الحالة"].map((head) => (
              <th
                className="pb-2 text-start font-medium"
                key={head}
                scope="col"
              >
                {head}
              </th>
            ))}
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
    </div>
  );
};

export const Books = ({ email }: { email: string }): ReactNode => {
  const state = useQuery({ args: {}, query: api.books.listAll });

  if (state.status === "pending") {
    return <Spinner label="جارٍ التحميل…" />;
  }

  if (state.status === "error") {
    const forbidden = errorCode(state.error) === "FORBIDDEN";

    return (
      <Empty>
        {forbidden
          ? `الحساب ${email} ليس ضمن قائمة المشرفين.`
          : errorMessage(state.error)}
      </Empty>
    );
  }

  return <Manager books={state.data} />;
};
