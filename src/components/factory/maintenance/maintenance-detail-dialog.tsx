"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ClipboardCheck,
  ClipboardList,
  Package,
  Wrench,
} from "lucide-react";

import { BatchSummary } from "@/components/factory/batch/batch-summary";
import { MaintenanceNextStep } from "@/components/factory/maintenance/maintenance-phase-forms";
import { MaintenancePhaseStepper } from "@/components/factory/maintenance/maintenance-phase-stepper";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FactoryRole } from "@/lib/factory/context";
import {
  PHASE_OF,
  STATUS_LABELS,
  STATUS_PILL,
  formatMinutes,
  formatStamp,
  maintenanceKeys,
  minutesSince,
  priorityMeta,
  type MaintenancePhase,
  type MaintenanceRequest,
} from "@/lib/factory/maintenance-queries";
import { cn } from "@/lib/utils";

/**
 * One maintenance request in full — the paper form, as three tabs.
 *
 * The document being replaced is a Breakdown Maintenance Request in three
 * sections, and that is exactly what the tabs are: Initiation, Engineering,
 * QA review. Not a stack of collapsible cards, because the whole point of the
 * sections is that they are *separate signatures* — reading Section 3 should
 * not mean scrolling past Section 2, and filling one in should not put the
 * others under your pen.
 *
 * The tab you land on is the one the request is actually waiting in, and the
 * form for the next gate lives inside that section rather than in a fourth
 * "actions" tab. Where the work is recorded is where the work is done.
 */
export function MaintenanceDetailDialog({
  request,
  factoryId,
  role,
  unitWord,
  onClose,
}: {
  request: MaintenanceRequest | null;
  factoryId: string;
  role: FactoryRole;
  unitWord: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0">
        {/* Keyed by the request, so opening a different one remounts with
            fresh state — including which tab you were on and any half-typed
            work record, which must never leak from one request to another. */}
        {request && (
          <Body
            key={request.id}
            request={request}
            factoryId={factoryId}
            role={role}
            unitWord={unitWord}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  request,
  factoryId,
  role,
  unitWord,
  onClose,
}: {
  request: MaintenanceRequest;
  factoryId: string;
  role: FactoryRole;
  unitWord: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const waiting = PHASE_OF[request.status];
  const [tab, setTab] = useState<MaintenancePhase>(waiting);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: maintenanceKeys.all(factoryId) });

  const priority = priorityMeta(request.priority);

  return (
    <>
      {/* ── Header: what this is, and how far it has got ─────────────── */}
      <DialogHeader className="shrink-0 gap-2 border-b border-[#EEF1F6] px-5 pt-5 pr-12 pb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className="bg-[#F1F5F9] font-mono text-[#475569]">
            {request.request_no}
          </Badge>
          <Badge className={priority.pill}>{priority.label}</Badge>
          <Badge className={STATUS_PILL[request.status]}>
            {STATUS_LABELS[request.status]}
          </Badge>
        </div>

        <DialogTitle className="flex flex-wrap items-baseline gap-x-2 text-base leading-snug text-[#0F1B34]">
          <span className="font-mono">{request.equipment_no}</span>
          {request.equipment_name && (
            <span className="font-normal text-[#475569]">
              {request.equipment_name}
            </span>
          )}
        </DialogTitle>
        <DialogDescription className="text-xs">
          {request.unit_name ?? `Not ${unitWord.toLowerCase()}-specific`}
          {request.department_name && ` · ${request.department_name}`}
          {" · raised "}
          {formatStamp(request.created_at)}
        </DialogDescription>

        <MaintenancePhaseStepper request={request} className="mt-1" />
      </DialogHeader>

      {/* ── The three sections ───────────────────────────────────────── */}
      <div className="shrink-0 px-5 pt-3">
        <div
          role="tablist"
          aria-label="Request sections"
          className="flex gap-1 rounded-xl bg-[#F1F5F9] p-1"
        >
          <TabButton
            active={tab === "initiation"}
            onClick={() => setTab("initiation")}
            Icon={ClipboardList}
            due={waiting === "initiation"}
          >
            Initiation
          </TabButton>
          <TabButton
            active={tab === "engineering"}
            onClick={() => setTab("engineering")}
            Icon={Wrench}
            due={waiting === "engineering"}
          >
            Engineering
          </TabButton>
          <TabButton
            active={tab === "qa"}
            onClick={() => setTab("qa")}
            Icon={ClipboardCheck}
            due={waiting === "qa" && request.status !== "verified"}
          >
            QA review
          </TabButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tab === "initiation" && (
          <Initiation
            request={request}
            factoryId={factoryId}
            unitWord={unitWord}
          />
        )}
        {tab === "engineering" && <Engineering request={request} />}
        {tab === "qa" && <Qa request={request} />}

        {/* The gate for whichever section is waiting, inside that section. */}
        {tab === waiting && (
          <div className="mt-5 border-t border-dashed border-[#E6EAF1] pt-5">
            <MaintenanceNextStep
              request={request}
              factoryId={factoryId}
              role={role}
              onDone={refresh}
            />
          </div>
        )}
      </div>

      {/* ── Footer: the clocks ───────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#EEF1F6] bg-[#FBFCFE] px-5 py-3">
        <Clocks request={request} />
        <button
          type="button"
          onClick={onClose}
          className="h-9 shrink-0 rounded-lg border border-[#E6EAF1] bg-white px-4 text-sm font-medium text-[#475569] transition hover:border-[#2563EB] hover:text-[#2563EB]"
        >
          Close
        </button>
      </div>
    </>
  );
}

/* ── Section 1 ────────────────────────────────────────────────────────── */

function Initiation({
  request,
  factoryId,
  unitWord,
}: {
  request: MaintenanceRequest;
  factoryId: string;
  unitWord: string;
}) {
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-[#E6EAF1] bg-[#FBFCFE] p-4 sm:grid-cols-3">
        <Fact label="Equipment ID">
          <span className="font-mono">{request.equipment_no}</span>
        </Fact>
        <Fact label="Equipment name">
          {request.equipment_name ?? (
            <span className="italic text-[#94A3B8]">Not in the register</span>
          )}
        </Fact>
        <Fact label={`${unitWord} no.`}>
          {request.unit_name ?? <span className="italic text-[#94A3B8]">—</span>}
        </Fact>
        <Fact label="Initiating department">
          {request.initiating_department_name ?? (
            <span className="italic text-[#94A3B8]">Not recorded</span>
          )}
        </Fact>
        <Fact label="Department needed">
          {request.department_name ?? (
            <span className="italic text-[#94A3B8]">Not yet decided</span>
          )}
        </Fact>
        <Fact label="Priority">{priorityMeta(request.priority).label}</Fact>
        <Fact label="Initiated by">
          {request.reported_by ?? (
            <span className="italic text-[#94A3B8]">Not recorded</span>
          )}
        </Fact>
        <Fact label="Date &amp; time">{formatStamp(request.created_at)}</Fact>
      </dl>

      <Section label="Description of problem">
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#334155]">
          {request.description}
        </p>
      </Section>

      {request.batch_no && (
        <Section label="Products impacted">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <Package className="size-4 shrink-0 translate-y-0.5 text-[#94A3B8]" />
            <span className="font-mono font-semibold text-[#0F1B34]">
              {request.batch_no}
            </span>
            {request.product_name && (
              <span className="text-[#475569]">{request.product_name}</span>
            )}
            {request.product_code && (
              <span className="font-mono text-xs text-[#94A3B8]">
                {request.product_code}
              </span>
            )}
          </p>
          <BatchSummary factoryId={factoryId} batchNo={request.batch_no} />
        </Section>
      )}
    </div>
  );
}

/* ── Section 2 ────────────────────────────────────────────────────────── */

function Engineering({ request }: { request: MaintenanceRequest }) {
  if (request.status === "reported") {
    return (
      <Empty
        icon={Wrench}
        title="Nothing here yet."
        body="Section 2 opens when the work is assigned to someone."
      />
    );
  }

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-[#E6EAF1] bg-[#FBFCFE] p-4 sm:grid-cols-3">
        <Fact label="Work assigned to">
          {request.assigned_to ?? (
            <span className="italic text-[#94A3B8]">—</span>
          )}
        </Fact>
        <Fact label="Assigned">{formatStamp(request.assigned_at)}</Fact>
        <Fact label="Work started">{formatStamp(request.work_started_at)}</Fact>
        <Fact label="Completed">{formatStamp(request.completed_at)}</Fact>
        <Fact label="Downtime">
          {request.downtime_minutes !== null ? (
            formatMinutes(request.downtime_minutes)
          ) : request.work_started_at ? (
            <span className="font-semibold text-[#B45309]">
              {formatMinutes(minutesSince(request.work_started_at))} and running
            </span>
          ) : (
            "—"
          )}
        </Fact>
        <Fact label="Response">{formatMinutes(request.response_minutes)}</Fact>
      </dl>

      {request.work_details && (
        <Section label="Details of maintenance work carried out">
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#334155]">
            {request.work_details}
          </p>
        </Section>
      )}

      {request.completed_at && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Answer
            question="Cleaning to be arranged"
            answer={request.cleaning_required}
            detail={request.cleaning_note}
          />
          <Answer
            question="Production review"
            answer={request.production_review_required}
            detail={
              request.production_review_by
                ? `${request.production_review_by} · ${formatStamp(request.production_review_at)}`
                : null
            }
          />
        </div>
      )}
    </div>
  );
}

/* ── Section 3 ────────────────────────────────────────────────────────── */

function Qa({ request }: { request: MaintenanceRequest }) {
  if (request.status !== "verified") {
    return (
      <Empty
        icon={ClipboardCheck}
        title="Not reviewed yet."
        body={
          request.status === "completed"
            ? "The work is signed off and waiting for QA."
            : "QA reviews the request once the work has been signed off."
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Answer
          question="Change control required"
          answer={request.change_control_required}
          detail={request.change_control_no}
          mono
        />
        <Answer
          question="Deviation raised"
          answer={request.deviation_raised}
          detail={request.deviation_no}
          mono
        />
      </div>

      {request.qa_remarks && (
        <Section label="Remarks">
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#334155]">
            {request.qa_remarks}
          </p>
        </Section>
      )}

      <Section label="QA sign">
        <p className="text-sm font-semibold text-[#0F1B34]">
          {request.qa_sign_name}
        </p>
        <p className="text-xs text-[#94A3B8]">
          {formatStamp(request.verified_at)}
        </p>
      </Section>
    </div>
  );
}

/* ── Shared bits ──────────────────────────────────────────────────────── */

/**
 * One of the form's yes/no boxes as it ended up.
 *
 * "Not answered" is a state this can render and deliberately looks unlike
 * "No" — the gate refuses to sign a section while either question is null, so
 * seeing it here means looking at an old record, and it should say so.
 */
function Answer({
  question,
  answer,
  detail,
  mono,
}: {
  question: string;
  answer: boolean | null;
  detail?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[#E6EAF1] bg-white p-3.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.5px] text-[#94A3B8]">
        {question}
      </p>
      <p
        className={cn(
          "mt-1 text-sm font-semibold",
          answer === null
            ? "italic text-[#94A3B8]"
            : answer
              ? "text-[#B45309]"
              : "text-[#475569]"
        )}
      >
        {answer === null ? "Not answered" : answer ? "Yes" : "No"}
      </p>
      {answer && detail && (
        <p className={cn("mt-0.5 text-xs text-[#475569]", mono && "font-mono")}>
          {detail}
        </p>
      )}
    </div>
  );
}

/** Response and downtime, side by side — the two numbers this module is for. */
function Clocks({ request }: { request: MaintenanceRequest }) {
  if (request.status === "reported") {
    return (
      <p className="min-w-0 truncate text-xs text-[#64748B]">
        Waiting{" "}
        <span className="font-semibold text-[#0F1B34]">
          {formatMinutes(minutesSince(request.created_at))}
        </span>{" "}
        for someone to take it
      </p>
    );
  }

  return (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-xs text-[#64748B]">
      <span>
        Response{" "}
        <span className="font-semibold text-[#0F1B34]">
          {formatMinutes(request.response_minutes)}
        </span>
      </span>
      <span>
        Downtime{" "}
        <span
          className={cn(
            "font-semibold",
            request.downtime_minutes === null && request.work_started_at
              ? "text-[#B45309]"
              : "text-[#0F1B34]"
          )}
        >
          {request.downtime_minutes !== null
            ? formatMinutes(request.downtime_minutes)
            : request.work_started_at
              ? `${formatMinutes(minutesSince(request.work_started_at))}…`
              : "—"}
        </span>
      </span>
    </p>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.6px] text-[#94A3B8]">
        {label}
      </p>
      {children}
    </section>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-[0.5px] text-[#94A3B8]">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-[13px] text-[#0F1B34]">{children}</dd>
    </div>
  );
}

function Empty({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[#CBD5E1] px-4 py-10 text-center">
      <Icon className="mx-auto mb-2 size-6 text-[#CBD5E1]" />
      <p className="text-sm text-[#64748B]">{title}</p>
      <p className="mt-1 text-xs text-[#94A3B8]">{body}</p>
    </div>
  );
}

/** The segmented control the actions and pipeline dialogs already use. */
function TabButton({
  active,
  onClick,
  Icon,
  due,
  children,
}: {
  active: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  due?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition",
        active
          ? "bg-white text-[#2563EB] shadow-[0_1px_2px_rgba(15,27,52,0.08)]"
          : "text-[#64748B] hover:text-[#0F1B34]"
      )}
    >
      <Icon className="size-4" />
      {children}
      {/* A dot rather than a count: there is only ever one section waiting,
          and "1" against it would invite the question "one what?". */}
      {due && (
        <span
          className="size-1.5 rounded-full bg-[#2563EB]"
          aria-label="waiting"
        />
      )}
    </button>
  );
}

function Badge({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        className
      )}
    >
      {children}
    </span>
  );
}
