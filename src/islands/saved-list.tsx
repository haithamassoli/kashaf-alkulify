import { X } from "lucide-react";
import { type MouseEvent, type ReactNode, useState } from "react";
import { savedItems, setSaved } from "../lib/saved";

const read = () =>
  Object.entries(savedItems()).sort((left, right) => right[1].at - left[1].at);

export const SavedList = (): ReactNode => {
  const [items, setItems] = useState(read);
  const remove = (href: string) => {
    setSaved(href);
    setItems(read());
  };
  const handleRemove = (event: MouseEvent<HTMLButtonElement>) =>
    remove(event.currentTarget.value);

  if (items.length === 0) {
    return (
      <p className="mt-8 text-muted">
        لا شيء محفوظ بعد. افتح درسًا أو مقالة واضغط زر الإشارة المرجعية.
      </p>
    );
  }

  return (
    <ul className="mt-8 space-y-3">
      {items.map(([href, item]) => (
        <li className="card flex items-start gap-3 p-4" key={href}>
          <span className="shrink-0 rounded-full bg-surface-2 px-3 py-1 text-muted text-xs">
            {item.kind === "v" ? "درس" : "مقالة"}
          </span>
          <a
            className="min-w-0 flex-1 font-medium leading-relaxed underline-offset-4 hover:underline"
            href={href}
          >
            {item.title}
          </a>
          <button
            aria-label={`أزل «${item.title}» من المحفوظات`}
            className="grid size-11 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:text-fg"
            onClick={handleRemove}
            type="button"
            value={href}
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </li>
      ))}
    </ul>
  );
};
