/**
 * The operations panel (report §6, لوحة التشغيل): is the system alive, and what
 * broke? Everything on it is read straight from the tables the pipeline already
 * writes — no background job feeds this page.
 */

import { useQuery_experimental as useQuery } from "convex/react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Lock,
  RadioTower,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import {
  ago,
  Chip,
  count,
  Dot,
  duration,
  Empty,
  num,
  Section,
  Spinner,
  stamp,
  Tile,
  type Tone,
} from "./ui";

/** §4.5: a lock whose heartbeat is older than this is stuck, not working. */
const STALE_LOCK_MS = 5 * 60 * 1000;
/** A channel that has not synced within this window is worth a red badge. */
const STALE_SYNC_MS = 6 * 60 * 60 * 1000;
/** How often the relative-time labels are recomputed. */
const TICK_MS = 30_000;

const RUN_TONE: Record<string, Tone> = {
  done: "accent",
  failed: "danger",
  interrupted: "warn",
  running: "warn",
};

const RUN_LABEL: Record<string, string> = {
  done: "سليم",
  failed: "فاشل",
  interrupted: "مقطوع",
  running: "قيد التشغيل",
};

const RUN_COLUMNS = ["المرحلة", "الحالة", "بدأ", "المدّة", "الحصيلة"];

interface Channel {
  id: string;
  lastMessageId: number;
  lastSyncAt: number;
  title: string;
  username: string;
}

interface PipelineLock {
  heartbeatAt: number;
  id: string;
  owner: string;
  stage: string;
}

interface Run {
  failureCount: number;
  id: string;
  skippedCount: number;
  stage: string;
  startedAt: number;
  status: string;
  successCount: number;
  wallTimeMs: number | null;
}

/** One shared clock, ticking a minute at a time — relative labels need it. */
const useNow = (): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);

    return () => clearInterval(timer);
  }, []);

  return now;
};

const Health = ({
  failures,
  staleLocks,
  staleSyncs,
}: {
  failures: number;
  staleLocks: number;
  staleSyncs: number;
}): ReactNode => {
  const problems = [
    failures > 0 ? `إخفاقات غير محلولة (${num(failures)})` : null,
    staleLocks > 0 ? `أقفال عالقة (${num(staleLocks)})` : null,
    staleSyncs > 0 ? `قنوات متأخّرة المزامنة (${num(staleSyncs)})` : null,
  ].filter((problem): problem is string => problem !== null);

  if (problems.length === 0) {
    return (
      <p className="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 text-accent text-sm">
        <CheckCircle2 aria-hidden="true" className="size-5 shrink-0" />
        كل شيء يعمل: لا إخفاقات معلّقة، ولا أقفال عالقة، والمزامنة حديثة.
      </p>
    );
  }

  return (
    <p className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <span>يحتاج انتباهك — {problems.join("، ")}.</span>
    </p>
  );
};

/** The §6 coverage counters: every unique binary's transcription state. */
const Coverage = (): ReactNode => {
  const state = useQuery({ args: {}, query: api.admin.transcriptCoverage });
  const data = state.status === "success" ? state.data : null;
  const value = (key: "done" | "failed" | "pending" | "processing") =>
    data === null ? "…" : count(data[key]);
  const busy = (key: "failed" | "pending" | "processing", tone: Tone): Tone =>
    data !== null && data[key].count > 0 ? tone : "muted";

  return (
    <Section
      description="حالة تفريغ كل ملف صوتي فريد، مقروءة من partTranscripts."
      title="تغطية التفريغ"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          hint="ملفًّا مفرَّغًا"
          label="مفرَّغ"
          tone="accent"
          value={value("done")}
        />
        <Tile
          hint="في انتظار الدور"
          label="معلّق"
          tone={busy("pending", "warn")}
          value={value("pending")}
        />
        <Tile
          hint="على الـGPU الآن"
          label="قيد المعالجة"
          tone={busy("processing", "warn")}
          value={value("processing")}
        />
        <Tile
          hint="يحتاج إعادة محاولة"
          label="فاشل"
          tone={busy("failed", "danger")}
          value={value("failed")}
        />
      </div>
    </Section>
  );
};

const ReviewQueue = (): ReactNode => {
  const state = useQuery({ args: {}, query: api.admin.reviewCounts });
  const data = state.status === "success" ? state.data : null;

  return (
    <Section
      description="التجميع الآلي يخفّض المشكوك فيه إلى طابور المراجعة (§4.7)."
      title="حالة الدروس"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile
          hint="تنتظر حكمك"
          label="تحتاج مراجعة"
          tone={data !== null && data.needsReview.count > 0 ? "warn" : "muted"}
          value={data === null ? "…" : count(data.needsReview)}
        />
        <Tile
          hint="جمّعها النظام بثقة"
          label="آلي"
          value={data === null ? "…" : count(data.auto)}
        />
        <Tile
          hint="لا يمسّها النظام"
          label="معتمد"
          tone="accent"
          value={data === null ? "…" : count(data.approved)}
        />
      </div>
    </Section>
  );
};

const ChannelCard = ({
  channel,
  now,
}: {
  channel: Channel;
  now: number;
}): ReactNode => {
  const stale = now - channel.lastSyncAt > STALE_SYNC_MS;

  return (
    <li className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{channel.title}</p>
          <p className="truncate text-muted text-xs" dir="ltr">
            @{channel.username}
          </p>
        </div>
        <Chip tone={stale ? "danger" : "accent"}>
          <RadioTower aria-hidden="true" className="size-3" />
          {ago(channel.lastSyncAt, now)}
        </Chip>
      </div>
      <dl className="mt-3 flex gap-6 text-xs">
        <div>
          <dt className="text-muted">آخر رسالة</dt>
          <dd className="digits mt-0.5 font-medium">
            {num(channel.lastMessageId)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">وقت المزامنة</dt>
          <dd className="digits mt-0.5 font-medium">
            {stamp(channel.lastSyncAt)}
          </dd>
        </div>
      </dl>
    </li>
  );
};

const RunRow = ({ now, run }: { now: number; run: Run }): ReactNode => {
  const tone = RUN_TONE[run.status] ?? "muted";

  return (
    <tr className="border-border border-t">
      <td className="px-4 py-3 font-medium" dir="ltr">
        {run.stage}
      </td>
      <td className="px-4 py-3">
        <Chip tone={tone}>
          <Dot tone={tone} />
          {RUN_LABEL[run.status] ?? run.status}
        </Chip>
      </td>
      <td className="px-4 py-3 text-muted text-xs">
        {ago(run.startedAt, now)}
      </td>
      <td className="digits px-4 py-3 text-xs">
        {run.wallTimeMs === null ? "—" : duration(run.wallTimeMs)}
      </td>
      <td className="px-4 py-3 text-muted text-xs">
        <span className="digits">{num(run.successCount)}</span> نجح ·{" "}
        <span className="digits">{num(run.skippedCount)}</span> تخطّى ·{" "}
        <span className={run.failureCount > 0 ? "text-destructive" : undefined}>
          <span className="digits">{num(run.failureCount)}</span> أخفق
        </span>
      </td>
    </tr>
  );
};

const LockCard = ({
  lock,
  now,
}: {
  lock: PipelineLock;
  now: number;
}): ReactNode => {
  const stale = now - lock.heartbeatAt > STALE_LOCK_MS;

  return (
    <li className="card flex items-center gap-3 p-4">
      <Lock
        aria-hidden="true"
        className={`size-5 shrink-0 ${stale ? "text-destructive" : "text-accent"}`}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm" dir="ltr">
          {lock.stage}
        </p>
        <p className="truncate text-muted text-xs" dir="ltr">
          {lock.owner}
        </p>
      </div>
      <Chip tone={stale ? "danger" : "accent"}>
        <Activity aria-hidden="true" className="size-3" />
        {stale ? "عالق" : "حيّ"} · {ago(lock.heartbeatAt, now)}
      </Chip>
    </li>
  );
};

export const Overview = (): ReactNode => {
  const now = useNow();
  const pulse = useQuery({ args: {}, query: api.admin.pulse });

  if (pulse.status === "pending") {
    return <Spinner label="جارٍ قراءة حالة النظام…" />;
  }

  if (pulse.status === "error") {
    return <Empty>تعذّر تحميل حالة النظام: {pulse.error.message}</Empty>;
  }

  const { channels, failures, locks, stages } = pulse.data;
  const staleLocks = locks.filter(
    (lock) => now - lock.heartbeatAt > STALE_LOCK_MS
  );
  const staleSyncs = channels.filter(
    (channel) => now - channel.lastSyncAt > STALE_SYNC_MS
  );

  return (
    <div className="pb-8">
      <Health
        failures={failures.total}
        staleLocks={staleLocks.length}
        staleSyncs={staleSyncs.length}
      />

      <Coverage />
      <ReviewQueue />

      <Section
        description="آخر مزامنة ناجحة وأعلى رقم رسالة بلغته كل قناة."
        title="نبض المزامنة"
      >
        <ul className="grid gap-3 md:grid-cols-2">
          {channels.map((channel) => (
            <ChannelCard channel={channel} key={channel.id} now={now} />
          ))}
        </ul>
      </Section>

      <Section
        description="أحدث تشغيل لكل مرحلة: مدّته وعدّاداته وكيف خرج."
        title="آخر التشغيلات"
      >
        {stages.length === 0 ? (
          <Empty>لم يُسجَّل أي تشغيل بعد.</Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted text-xs">
                <tr>
                  {RUN_COLUMNS.map((head) => (
                    <th
                      className="px-4 py-3 text-start font-medium"
                      key={head}
                      scope="col"
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stages.map((run) => (
                  <RunRow key={run.id} now={now} run={run} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        description="قفل حيّ يعني تشغيلًا جاريًا؛ قفل نبضته قديمة يعني تشغيلًا مات دون أن يُفرج عنه."
        title="أقفال المراحل"
      >
        {locks.length === 0 ? (
          <Empty>لا أقفال — لا مرحلة تعمل الآن.</Empty>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {locks.map((lock) => (
              <LockCard key={lock.id} lock={lock} now={now} />
            ))}
          </ul>
        )}
      </Section>

      {failures.byStage.length > 0 && (
        <Section
          description="موزَّعة على المراحل. التفاصيل في تبويب الإخفاقات."
          title="إخفاقات غير محلولة"
        >
          <ul className="flex flex-wrap gap-2">
            {failures.byStage.map((entry) => (
              <li key={entry.stage}>
                <Chip tone="danger">
                  <span dir="ltr">{entry.stage}</span>
                  <span className="digits font-medium">{num(entry.count)}</span>
                </Chip>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
};
