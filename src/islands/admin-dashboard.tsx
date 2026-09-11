/**
 * The dashboard shell: one Convex provider, one auth gate, and a sidebar that
 * switches between panels. Routing is `location.hash`, so a panel is
 * bookmarkable and survives reload without pulling in a router.
 */

import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import {
  ConvexReactClient,
  useQuery_experimental as useQuery,
} from "convex/react";
import {
  AlertTriangle,
  BookMarked,
  FileText,
  Gauge,
  GraduationCap,
  LogOut,
  Menu,
} from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { api } from "../../convex/_generated/api";
import { authClient } from "../lib/auth-client";
import { Articles } from "./admin/articles";
import { Books } from "./admin/books";
import { Failures } from "./admin/failures";
import { Lessons } from "./admin/lessons";
import { Overview } from "./admin/overview";
import {
  Chip,
  count,
  errorCode,
  errorMessage,
  FIELD,
  num,
  PRIMARY,
  SECONDARY,
} from "./admin/ui";

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

const SIGN_IN_ERRORS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  USER_NOT_FOUND: "لا يوجد حساب بهذا البريد الإلكتروني.",
};

const signOut = () => {
  authClient.signOut();
};

const PANELS = [
  { icon: Gauge, id: "overview", label: "نظرة عامة" },
  { icon: GraduationCap, id: "lessons", label: "الدروس" },
  { icon: FileText, id: "articles", label: "المقالات" },
  { icon: AlertTriangle, id: "failures", label: "الإخفاقات" },
  { icon: BookMarked, id: "books", label: "الكتب" },
] as const;

type PanelId = (typeof PANELS)[number]["id"];

const HASH_PREFIX = /^#\/?/;

const isPanelId = (value: string): value is PanelId =>
  PANELS.some((panel) => panel.id === value);

/** The panel named by `#/<id>`, defaulting to the overview. */
const usePanel = (): [PanelId, (id: PanelId) => void] => {
  const [panel, setPanel] = useState<PanelId>("overview");

  useEffect(() => {
    const read = () => {
      const id = window.location.hash.replace(HASH_PREFIX, "");

      setPanel(isPanelId(id) ? id : "overview");
    };

    read();
    window.addEventListener("hashchange", read);

    return () => window.removeEventListener("hashchange", read);
  }, []);

  return [
    panel,
    (id: PanelId) => {
      window.location.hash = `#/${id}`;
    },
  ];
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
      const known = result.error.code
        ? SIGN_IN_ERRORS[result.error.code]
        : undefined;

      setError(
        known ?? result.error.message ?? "تعذّر تسجيل الدخول. حاول مرة أخرى."
      );
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
            className={`${FIELD} mt-2`}
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
            className={`${FIELD} mt-2`}
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
          className={`${PRIMARY} mt-2 w-full`}
          disabled={pending}
          type="submit"
        >
          {pending ? "جارٍ الدخول…" : "تسجيل الدخول"}
        </button>
      </form>
    </div>
  );
};

/**
 * A signed-in account that is not on the `ADMIN_EMAILS` allowlist gets its own
 * copy — that is the one failure the operator can actually act on.
 */
const Forbidden = ({
  email,
  error,
}: {
  email: string;
  error: Error;
}): ReactNode => {
  const forbidden = errorCode(error) === "FORBIDDEN";

  return (
    <section className="card mx-auto mt-16 max-w-lg p-6">
      <h1 className="font-semibold text-lg">
        {forbidden ? "ليس لديك صلاحية الوصول" : "تعذّر فتح لوحة التحكم"}
      </h1>
      <p className="mt-2 text-muted leading-8">
        {forbidden
          ? `الحساب ${email} ليس ضمن قائمة المشرفين. سجّل الخروج ثم ادخل بحساب مشرف.`
          : errorMessage(error)}
      </p>
      <button className={`${SECONDARY} mt-4`} onClick={signOut} type="button">
        تسجيل الخروج
      </button>
    </section>
  );
};

/** Live badge counts beside the nav labels, so a problem is visible from anywhere. */
const useBadges = (): Partial<Record<PanelId, Badge>> => {
  const pulse = useQuery({ args: {}, query: api.admin.pulse });
  const review = useQuery({ args: {}, query: api.admin.reviewCounts });

  const badges: Partial<Record<PanelId, Badge>> = {};

  if (pulse.status === "success" && pulse.data.failures.total > 0) {
    badges.failures = { alert: true, text: num(pulse.data.failures.total) };
  }

  if (review.status === "success" && review.data.needsReview.count > 0) {
    badges.lessons = { alert: false, text: count(review.data.needsReview) };
  }

  return badges;
};

interface Badge {
  alert: boolean;
  text: string;
}

const NavButton = ({
  badge,
  current,
  id,
  icon: Icon,
  label,
  onSelect,
}: {
  badge?: Badge;
  current: boolean;
  icon: (typeof PANELS)[number]["icon"];
  id: PanelId;
  label: string;
  onSelect: (id: PanelId) => void;
}): ReactNode => {
  const handleClick = () => onSelect(id);

  return (
    <button
      aria-current={current ? "page" : undefined}
      className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
        current
          ? "bg-accent-soft font-medium text-accent"
          : "text-muted hover:bg-surface-2 hover:text-fg"
      }`}
      onClick={handleClick}
      type="button"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="flex-1 text-start">{label}</span>
      {badge && (
        <Chip tone={badge.alert ? "danger" : "warn"}>
          <span className="digits">{badge.text}</span>
        </Chip>
      )}
    </button>
  );
};

const Shell = ({ email }: { email: string }): ReactNode => {
  const [panel, go] = usePanel();
  const [open, setOpen] = useState(false);
  const badges = useBadges();
  const pulse = useQuery({ args: {}, query: api.admin.pulse });

  if (pulse.status === "error") {
    return <Forbidden email={email} error={pulse.error} />;
  }

  const active = PANELS.find((item) => item.id === panel) ?? PANELS[0];

  const select = (id: PanelId) => {
    go(id);
    setOpen(false);
  };

  const handleMenu = () => setOpen((was) => !was);

  const nav = (
    <nav aria-label="أقسام لوحة التحكم" className="flex flex-col gap-1">
      {PANELS.map((item) => (
        <NavButton
          badge={badges[item.id]}
          current={item.id === panel}
          icon={item.icon}
          id={item.id}
          key={item.id}
          label={item.label}
          onSelect={select}
        />
      ))}
    </nav>
  );

  return (
    <div className="gap-8 pb-10 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-20 lg:self-start lg:pt-8">
        <div className="flex items-center justify-between gap-3 pt-6 lg:hidden">
          <h1 className="font-semibold text-xl tracking-tight">
            {active.label}
          </h1>
          <button
            aria-expanded={open}
            aria-label="أقسام لوحة التحكم"
            className={SECONDARY}
            onClick={handleMenu}
            type="button"
          >
            <Menu aria-hidden="true" className="size-4" />
            الأقسام
          </button>
        </div>

        <div className={`mt-4 lg:mt-0 lg:block ${open ? "block" : "hidden"}`}>
          {nav}
          <div className="mt-4 border-border border-t pt-4">
            <p className="truncate px-3 text-muted text-xs" dir="ltr">
              {email}
            </p>
            <button
              className="mt-2 flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-muted text-sm transition-colors hover:bg-surface-2 hover:text-fg"
              onClick={signOut}
              type="button"
            >
              <LogOut aria-hidden="true" className="size-4" />
              تسجيل الخروج
            </button>
          </div>
        </div>
      </div>

      <div className="min-w-0 pt-6 lg:pt-8">
        <h1 className="hidden font-semibold text-2xl tracking-tight lg:block">
          {active.label}
        </h1>
        <div className="mt-6">
          {panel === "overview" && <Overview />}
          {panel === "lessons" && <Lessons />}
          {panel === "articles" && <Articles />}
          {panel === "failures" && <Failures />}
          {panel === "books" && <Books email={email} />}
        </div>
      </div>
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

  return <Shell email={session.user.email} />;
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
