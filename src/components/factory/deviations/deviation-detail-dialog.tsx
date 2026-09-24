"use client";

import { useState } from "react";
import {
  ClipboardCheck,
  ClipboardList,
  FlaskConical,
  Gauge,
  History,
  Lock,
  Search,
  ShieldCheck,
  Wrench,
} from "lucide-react";

import {
  Badge,
  Fact,
  Muted,
  formatDate,
} from "@/components/factory/deviations/deviation-fields";
import {
  ActionPlanTab,
  CloseOutTab,
  ContainmentTab,
  InitiationTab,
  InvestigationTab,
  RiskTab,
} from "@/components/factory/deviations/deviation-tab-forms";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { canReview } from "@/lib/factory/action-queries";
import type { FactoryRole } from "@/lib/factory/context";
import {
  RISK_PILL,
  STATUS_LABELS,
  STATUS_PILL,
  dispositionMeta,
  outstanding,
  priorityMeta,
  typeMeta,
  type Deviation,
} from "@/lib/factory/deviation-queries";
import { formatStamp } from "@/lib/factory/maintenance-queries";
import { cn } from "@/lib/utils";

type Tab =
  | "initiation"
  | "containment"
  | "risk"
  | "investigation"
  | "corrective"
  | "preventive"
  | "closeout"
  | "aging";

const TABS: { id: Tab; label: string; icon: typeof ClipboardList }[] = [
  { id: "initiation", label: "Initiation", icon: ClipboardList },
  { id: "containment", label: "Containment", icon: ShieldCheck },
  { id: "risk", label: "Risk", icon: Gauge },
  { id: "investigation", label: "Investigation", icon: Search },
  { id: "corrective", label: "Corrective", icon: Wrench },
  { id: "preventive", label: "Preventive", icon: FlaskConical },
  { id: "closeout", label: "Close out", icon: ClipboardCheck },
  { id: "aging", label: "Aging", icon: History },
];

/**
 * One case in full — the QMS document, as its own tabs.
 *
 * The tabs are the reference system's, in its order, because they are the
 * order the facts arrive in: what happened, what we did about it at once, how
 * bad it is, what caused it, what we are doing, what stops it returning, and
 * the sign-off. Each one saves itself; only the close-out is a gate.
 *
 * A dot against a tab means the close-out is waiting on something it holds.
 */
export function DeviationDetailDialog({
  deviation,
  factoryId,
  role,
  onClose,
}: {
  deviation: Deviation | null;
  factoryId: string;
  role: FactoryRole;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={deviation !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-4xl flex-col gap-0 overflow-hidden p-0">
        {/* Keyed, so a half-typed investigation never leaks between cases. */}
        {deviation && (
          <Body
            key={deviation.id}
            deviation={deviation}
            factoryId={factoryId}
            role={role}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  deviation,
  factoryId,
  role,
  onClose,
}: {
  deviation: Deviation;
  factoryId: string;
  role: FactoryRole;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("initiation");

  const meta = typeMeta(deviation.type);
  const priority = priorityMeta(deviation.priority);
  const disposition = deviation.disposition
    ? dispositionMeta(deviation.disposition)
    : null;

  // A closed case is a signed document; below supervisor, the case is a read.
  const readOnly = deviation.status === "closed" || !canReview(role);
  const gaps = outstanding(deviation);
  const waiting = new Set(gaps.map((g) => g.tab as string));

  return (
    <>
      <DialogHeader className="shrink-0 gap-2 border-b border-line bg-surface px-5 pt-5 pr-12 pb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className="bg-sunken-2 font-mono text-ink-3">
            {deviation.deviation_no}
          </Badge>
          <Badge className={meta.pill}>{meta.label}</Badge>
          <Badge className={priority.pill}>{priority.label}</Badge>
          {deviation.risk_conclusion && (
            <Badge className={RISK_PILL[deviation.risk_conclusion]}>
              Risk {deviation.risk_conclusion}
            </Badge>
          )}
          {disposition && (
            <Badge className={disposition.pill}>{disposition.label}</Badge>
          )}
          <Badge className={STATUS_PILL[deviation.status]}>
            {STATUS_LABELS[deviation.status]}
          </Badge>
          {deviation.is_overdue && (
            <Badge className="bg-danger-soft text-danger-deep">Overdue</Badge>
          )}
        </div>

        <DialogTitle className="text-base leading-snug text-ink">
          {deviation.title}
        </DialogTitle>
        <DialogDescription className="text-xs">
          {deviation.batch_no && (
            <>
              <span className="font-mono">{deviation.batch_no}</span>
              {deviation.product_name && ` · ${deviation.product_name}`}
              {" · "}
            </>
          )}
          raised {formatStamp(deviation.created_at)}
          {deviation.raised_by && ` by ${deviation.raised_by}`}
        </DialogDescription>

        {deviation.is_quarantining && (
          <p className="mt-1 flex items-start gap-2 rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger-deep">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            Batch {deviation.batch_no} is on hold under this NCR. Preparatory
            and production work can&apos;t be logged against it until the case
            is closed; downtime still can.
          </p>
        )}
      </DialogHeader>

      <div className="shrink-0 px-5 pt-3">
        <div
          role="tablist"
          aria-label="Case sections"
          className="scrollbar-slim flex gap-1 overflow-x-auto rounded-xl border border-line bg-sunken-2 p-1"
        >
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(id)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition",
                  active
                    ? "bg-surface text-brand-deep shadow-[0_1px_3px_rgb(20_22_43/0.12)] ring-1 ring-line"
                    : "text-ink-4 hover:bg-surface/60 hover:text-ink",
                )}
              >
                <Icon className="size-3.5" />
                {label}
                {/* Outstanding for the close-out, on the tab that holds it. */}
                {waiting.has(id) && deviation.status === "open" && (
                  <span
                    className="size-1.5 rounded-full bg-warn"
                    aria-label="still needed"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tab === "initiation" && (
          <InitiationTab
            deviation={deviation}
            factoryId={factoryId}
            readOnly={readOnly}
          />
        )}
        {tab === "containment" && (
          <ContainmentTab
            deviation={deviation}
            factoryId={factoryId}
            readOnly={readOnly}
          />
        )}
        {tab === "risk" && (
          <RiskTab
            deviation={deviation}
            factoryId={factoryId}
            readOnly={readOnly}
          />
        )}
        {tab === "investigation" && (
          <InvestigationTab
            deviation={deviation}
            factoryId={factoryId}
            readOnly={readOnly}
          />
        )}
        {tab === "corrective" && (
          <ActionPlanTab
            deviation={deviation}
            factoryId={factoryId}
            kind="ca"
            readOnly={readOnly}
          />
        )}
        {tab === "preventive" && (
          <ActionPlanTab
            deviation={deviation}
            factoryId={factoryId}
            kind="pa"
            readOnly={readOnly}
          />
        )}
        {tab === "closeout" && (
          <CloseOutTab
            deviation={deviation}
            factoryId={factoryId}
            readOnly={!canReview(role)}
          />
        )}
        {tab === "aging" && <Aging deviation={deviation} />}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-surface px-5 py-3">
        <p className="min-w-0 truncate text-xs text-ink-4">
          {deviation.status === "closed" ? (
            <>
              Closed after{" "}
              <span className="font-semibold text-ink">
                {deviation.age_days} days
              </span>
            </>
          ) : (
            <>
              Open{" "}
              <span className="font-semibold text-ink">
                {deviation.age_days} days
              </span>
              {deviation.days_to_sla !== null &&
                (deviation.days_to_sla < 0 ? (
                  <span className="text-danger-deep">
                    {" "}
                    · {Math.abs(deviation.days_to_sla)} past its SLA date
                  </span>
                ) : (
                  <> · {deviation.days_to_sla} to its SLA date</>
                ))}
            </>
          )}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="h-9 shrink-0 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink-3 shadow-soft transition hover:border-brand hover:text-brand"
        >
          Close
        </button>
      </div>
    </>
  );
}

/**
 * Case aging — every date the case carries, in one place.
 *
 * All of it computed or stamped elsewhere: this tab stores nothing and asks
 * nothing. It is the answer to "how long has this been sitting?", which on
 * the reference system is its own tab for exactly that reason.
 */
function Aging({ deviation }: { deviation: Deviation }) {
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-3">
        <Fact label="Age">
          {deviation.age_days} day{deviation.age_days === 1 ? "" : "s"}
        </Fact>
        <Fact label="SLA date">{formatDate(deviation.sla_date)}</Fact>
        <Fact label="Days to SLA">
          {deviation.days_to_sla === null ? (
            <Muted>No SLA set</Muted>
          ) : deviation.days_to_sla < 0 ? (
            <span className="font-semibold text-danger-deep">
              {Math.abs(deviation.days_to_sla)} overdue
            </span>
          ) : (
            deviation.days_to_sla
          )}
        </Fact>
      </dl>

      <ol className="space-y-2">
        <Step label="Raised" at={formatStamp(deviation.created_at)} done />
        <Step
          label="Immediate action"
          at={formatDate(deviation.immediate_action_date)}
          done={Boolean(deviation.immediate_action_date)}
        />
        <Step
          label="Risk assessed"
          at={formatStamp(deviation.risk_assessed_at)}
          done={Boolean(deviation.risk_assessed_at)}
        />
        <Step
          label="Investigated"
          at={formatStamp(deviation.investigated_at)}
          done={Boolean(deviation.investigated_at)}
        />
        <Step
          label="Corrective action closed"
          at={formatDate(deviation.ca_closed_date)}
          done={Boolean(deviation.ca_closed_date)}
        />
        <Step
          label="Preventive action closed"
          at={formatDate(deviation.pa_closed_date)}
          done={Boolean(deviation.pa_closed_date)}
        />
        <Step
          label="Case closed"
          at={formatStamp(deviation.closed_at)}
          done={deviation.status === "closed"}
        />
      </ol>
    </div>
  );
}

function Step({
  label,
  at,
  done,
}: {
  label: string;
  at: string;
  done: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-line-soft bg-surface px-3.5 py-2.5">
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            done ? "bg-teal" : "bg-line-strong",
          )}
        />
        <span
          className={cn(
            "truncate text-[13px]",
            done ? "font-medium text-ink" : "text-ink-5",
          )}
        >
          {label}
        </span>
      </span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-4">
        {done ? at : "—"}
      </span>
    </li>
  );
}
