"use client";

import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useWatch } from "react-hook-form";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import {
  RCA_METHODS,
  ROOT_CAUSE_CATEGORIES,
  STATUS_REASONS,
  actionPlanSchema,
  closeOutSchema,
  containmentSchema,
  initiationSchema,
  investigationSchema,
  riskSchema,
  type ActionPlanValues,
  type CloseOutValues,
  type ContainmentValues,
  type InitiationValues,
  type InvestigationValues,
  type RiskValues,
} from "@/app/factory/[slug]/deviations/schemas";
import {
  AREA,
  Cols,
  CONTROL,
  DateControl,
  Fact,
  Field,
  Group,
  Muted,
  PersonControl,
  FooterActions,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SaveBar,
  SelectControl,
  YesNo,
  formatDate,
} from "@/components/factory/deviations/deviation-fields";
import { InitiationFields } from "@/components/factory/deviations/initiation-fields";
import {
  DISPOSITIONS,
  RISK_SCALES,
  RISK_TEXT,
  closeDeviation,
  deviationKeys,
  outstanding,
  saveActionPlan,
  saveCloseOutPlan,
  saveContainment,
  saveInitiation,
  saveInvestigation,
  saveRisk,
  riskOf,
  scaleLabel,
  type Deviation,
} from "@/lib/factory/deviation-queries";
import { pipelineKeys } from "@/lib/factory/pipeline-queries";
import { useWorkers } from "@/lib/factory/worker-queries";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/factory/dates";

/**
 * One form per tab of the case.
 *
 * Every tab saves itself and none of them is a gate: a case is worked over
 * days, and a form that refuses a containment action because nobody has
 * investigated yet is a form people fill in afterwards, from memory. The one
 * gate is the close-out, and it is the database's — `deviations_guard`
 * re-checks every starred field these forms ask for.
 *
 * A closed case renders as facts instead of fields, because it is a signed
 * document by then. So does a case seen by someone below supervisor.
 */

/** Saving any tab invalidates the register; the quarantine chip rides on it. */
function useTabSave<T>(
  factoryId: string,
  run: (values: T) => Promise<void>,
  message: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: deviationKeys.all(factoryId),
      });
      toast.success(message);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* ── Tab 1 · Initiation ───────────────────────────────────────────────── */

export function InitiationTab({
  deviation,
  factoryId,
  readOnly,
}: {
  deviation: Deviation;
  factoryId: string;
  readOnly: boolean;
}) {
  // A planned or unplanned deviation is raised on the reference QMS's form
  // (0062) and is a record from then on: its details are shown, never edited.
  // NCRs and complaints keep their editable form.
  if (deviation.type === "planned" || deviation.type === "unplanned") {
    return <DeviationInitiationFacts deviation={deviation} />;
  }
  return (
    <CaseInitiationTab
      deviation={deviation}
      factoryId={factoryId}
      readOnly={readOnly}
    />
  );
}

function DeviationInitiationFacts({ deviation }: { deviation: Deviation }) {
  const batches =
    deviation.batch_nos.length > 0
      ? deviation.batch_nos
      : deviation.batch_no
        ? [deviation.batch_no]
        : [];
  return (
    <div className="space-y-6">
      <Group title="Initiation">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact label="Title" wide>
            {deviation.title}
          </Fact>
          <Fact label="Planned or unplanned">
            {deviation.type === "planned" ? "Planned" : "Unplanned"}
          </Fact>
          <Fact label="When it happened">
            {deviation.occurred_at ? (
              formatDateTime(deviation.occurred_at)
            ) : (
              <Muted>Not recorded</Muted>
            )}
          </Fact>
          <Fact label="Department">
            {deviation.department_name ?? <Muted>—</Muted>}
          </Fact>
          <Fact label="Location">
            {deviation.location ?? <Muted>—</Muted>}
          </Fact>
          <Fact label="Detected at">
            {deviation.detection_point ?? deviation.origin ?? <Muted>—</Muted>}
          </Fact>
          <Fact label="Batches" mono>
            {batches.length > 0 ? batches.join(", ") : <Muted>—</Muted>}
          </Fact>
          <Fact label="Products" wide>
            {deviation.product_names.length > 0 ? (
              deviation.product_names.join(", ")
            ) : (
              <Muted>—</Muted>
            )}
          </Fact>
          <Fact label="What happened" wide>
            {deviation.actual}
          </Fact>
          <Fact label="Immediate action" wide>
            {deviation.immediate_action ?? <Muted>Not recorded</Muted>}
          </Fact>
          <Fact label="Batch on hold">
            {deviation.hold_batch === null ? (
              <Muted>Not asked</Muted>
            ) : deviation.hold_batch ? (
              "Yes"
            ) : (
              "No"
            )}
          </Fact>
          <Fact label="Equipment">
            {deviation.equipment_no ? (
              <>
                <span className="font-mono">{deviation.equipment_no}</span>
                {deviation.equipment_name && ` · ${deviation.equipment_name}`}
              </>
            ) : (
              <Muted>—</Muted>
            )}
          </Fact>
          <Fact label="Reference document / SOP" mono>
            {deviation.sop_number ?? <Muted>—</Muted>}
          </Fact>
          <Fact label="Procedure name">
            {deviation.procedure_name ?? <Muted>—</Muted>}
          </Fact>
          <Fact label="Raised by">
            {deviation.raised_by ?? <Muted>—</Muted>}
          </Fact>
        </dl>
      </Group>
    </div>
  );
}

/** An NCR's or a complaint's Initiation tab — the original form. */
function CaseInitiationTab({
  deviation,
  factoryId,
  readOnly,
}: {
  deviation: Deviation;
  factoryId: string;
  readOnly: boolean;
}) {
  const form = useForm<InitiationValues>({
    resolver: zodResolver(initiationSchema),
    defaultValues: {
      type: deviation.type,
      title: deviation.title,
      priority: deviation.priority,
      origin: (deviation.origin ?? "") as InitiationValues["origin"],
      ncCategory: (deviation.nc_category ??
        "") as InitiationValues["ncCategory"],
      slaDate: deviation.sla_date ?? "",
      batchNo: deviation.batch_no ?? "",
      customerName: deviation.customer_name ?? "",
      customerOther: deviation.customer_other ?? "",
      supplierName: deviation.supplier_name ?? "",
      ownerName: deviation.owner_name ?? "",
      raisedBy: deviation.raised_by ?? "",
      supervisorName: deviation.supervisor_name ?? "",
      qaReviewer: deviation.qa_reviewer ?? "",
      procedureName: deviation.procedure_name ?? "",
      sopNumber: deviation.sop_number ?? "",
      documentNumber: deviation.document_number ?? "",
      rawMaterialCode: deviation.raw_material_code ?? "",
      rawMaterialName: deviation.raw_material_name ?? "",
      packagingMaterialCode: deviation.packaging_material_code ?? "",
      equipmentNo: deviation.equipment_no ?? "",
      specification: deviation.specification ?? "",
      actual: deviation.actual,
      impact: deviation.impact ?? "",
      immediateActionDate: deviation.immediate_action_date ?? "",
      immediateAction: deviation.immediate_action ?? "",
      disposition: deviation.disposition ?? "",
      actionId: deviation.action_id ?? "",
      receivedVia: (deviation.received_via ??
        "") as InitiationValues["receivedVia"],
      adverseReaction:
        deviation.adverse_reaction === null
          ? ""
          : deviation.adverse_reaction
            ? "yes"
            : "no",
    },
  });

  const queryClient = useQueryClient();
  const save = useTabSave<InitiationValues>(
    factoryId,
    async (values) => {
      await saveInitiation(deviation.id, values);
      // A disposition changed to or from quarantine moves the board.
      await queryClient.invalidateQueries({
        queryKey: pipelineKeys.all(factoryId),
      });
    },
    "Case details saved.",
  );

  if (readOnly) return <InitiationFacts deviation={deviation} />;

  return (
    <form
      onSubmit={form.handleSubmit((v) => save.mutateAsync(v).catch(() => {}))}
      className="space-y-6"
    >
      <InitiationFields form={form} factoryId={factoryId} locked />
      <SaveBar pending={form.formState.isSubmitting}>
        Corrections are saved straight onto the case.
      </SaveBar>
    </form>
  );
}

function InitiationFacts({ deviation }: { deviation: Deviation }) {
  // A deviation shows the shorter set its form asks for (see InitiationFields).
  const dev = deviation.type === "planned" || deviation.type === "unplanned";
  const ncr = deviation.type === "ncr";
  // Shared by the trimmed deviation and NCR forms (see InitiationFields).
  const short = dev || ncr;
  const complaint = deviation.type === "complaint";
  return (
    <div className="space-y-6">
      <Group title="Case details">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact label="Case title" wide>
            {deviation.title}
          </Fact>
          <Fact label="Origin">{deviation.origin ?? <Muted>—</Muted>}</Fact>
          {ncr && (
            <Fact label="Non-conformance">
              {deviation.nc_category ?? <Muted>—</Muted>}
            </Fact>
          )}
          <Fact label={short || complaint ? "Due date" : "SLA date"}>
            {formatDate(deviation.sla_date)}
          </Fact>
          {deviation.type === "complaint" && (
            <>
              <Fact label="Received via">
                {deviation.received_via ?? <Muted>—</Muted>}
              </Fact>
              <Fact label="Injury or adverse reaction reported">
                {deviation.adverse_reaction === null ? (
                  <Muted>Not answered</Muted>
                ) : deviation.adverse_reaction ? (
                  "Yes"
                ) : (
                  "No"
                )}
              </Fact>
            </>
          )}
        </dl>
      </Group>

      <Group title="Product & batch">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact label="Batch number" mono>
            {deviation.batch_no ?? <Muted>—</Muted>}
          </Fact>
          <Fact label="Product name">
            {deviation.product_name ?? <Muted>Not in the catalogue</Muted>}
          </Fact>
          <Fact label="Product code" mono>
            {deviation.product_code ?? <Muted>—</Muted>}
          </Fact>
          <Fact label="Customer">
            {deviation.customer_name ?? <Muted>—</Muted>}
          </Fact>
          {!short && !complaint && (
            <Fact label="Customer others">
              {deviation.customer_other ?? <Muted>—</Muted>}
            </Fact>
          )}
          {!dev && (
            <Fact label="Supplier">
              {deviation.supplier_name ?? <Muted>—</Muted>}
            </Fact>
          )}
        </dl>
      </Group>

      <Group title="People">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact label="Case owner">
            {deviation.owner_name ?? <Muted>—</Muted>}
          </Fact>
          <Fact label="Raised by">
            {deviation.raised_by ?? <Muted>—</Muted>}
          </Fact>
          <Fact label="Supervisor">
            {deviation.supervisor_name ?? <Muted>—</Muted>}
          </Fact>
          {!short && !complaint && (
            <Fact label="QA reviewer">
              {deviation.qa_reviewer ?? <Muted>—</Muted>}
            </Fact>
          )}
        </dl>
      </Group>

      {!complaint && (
        <Group
          title={
            dev
              ? "Equipment & procedure"
              : ncr
                ? "Materials & equipment"
                : "Materials, equipment & documents"
          }
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            {!dev && (
              <>
                <Fact label="Raw material code" mono>
                  {deviation.raw_material_code ?? <Muted>—</Muted>}
                </Fact>
                <Fact label="Raw material name">
                  {deviation.raw_material_name ?? <Muted>—</Muted>}
                </Fact>
                <Fact label="Packaging material code" mono>
                  {deviation.packaging_material_code ?? <Muted>—</Muted>}
                </Fact>
              </>
            )}
            <Fact label="Equipment">
              {deviation.equipment_no ? (
                <>
                  <span className="font-mono">{deviation.equipment_no}</span>
                  {deviation.equipment_name && ` · ${deviation.equipment_name}`}
                </>
              ) : (
                <Muted>—</Muted>
              )}
            </Fact>
            <Fact label="Procedure">
              {deviation.procedure_name ?? <Muted>—</Muted>}
            </Fact>
            {!ncr && (
              <Fact label="SOP number" mono>
                {deviation.sop_number ?? <Muted>—</Muted>}
              </Fact>
            )}
            {!short && (
              <Fact label="Document number" mono>
                {deviation.document_number ?? <Muted>—</Muted>}
              </Fact>
            )}
          </dl>
        </Group>
      )}

      <Group title="The event">
        <dl className="grid gap-3">
          {!short && !complaint && deviation.specification && (
            <Fact label="Specification / requirement" wide>
              {deviation.specification}
            </Fact>
          )}
          <Fact label="Event description" wide>
            {deviation.actual}
          </Fact>
          {!short && deviation.impact && (
            <Fact label="Potential impact" wide>
              {deviation.impact}
            </Fact>
          )}
        </dl>
      </Group>

      <Group title="Immediate / containment action">
        <dl className="grid gap-3">
          <Fact label="Immediate action date">
            {formatDate(deviation.immediate_action_date)}
          </Fact>
          <Fact label="Immediate action taken" wide>
            {deviation.immediate_action ?? <Muted>Not recorded</Muted>}
          </Fact>
        </dl>
      </Group>
    </div>
  );
}

/* ── Tab 2 · Immediate / containment action ───────────────────────────── */

// Unwired: these fields are on the Initiation tab now (`InitiationFields`),
// as the reference QMS has them. Kept, like `ActionPlanTab`, not deleted.

export function ContainmentTab({
  deviation,
  factoryId,
  readOnly,
}: {
  deviation: Deviation;
  factoryId: string;
  readOnly: boolean;
}) {
  const form = useForm<ContainmentValues>({
    resolver: zodResolver(containmentSchema),
    defaultValues: {
      immediateActionDate: deviation.immediate_action_date ?? "",
      immediateAction: deviation.immediate_action ?? "",
    },
  });

  const save = useTabSave<ContainmentValues>(
    factoryId,
    (values) => saveContainment(deviation.id, values),
    "Containment action saved.",
  );

  if (readOnly) {
    return (
      <dl className="grid gap-3">
        <Fact label="Immediate action date">
          {formatDate(deviation.immediate_action_date)}
        </Fact>
        <Fact label="Immediate action taken" wide>
          {deviation.immediate_action ?? <Muted>Not recorded</Muted>}
        </Fact>
      </dl>
    );
  }

  return (
    <form
      onSubmit={form.handleSubmit((v) => save.mutateAsync(v).catch(() => {}))}
      className="space-y-4"
    >
      <Intro
        title="What was done straight away"
        body="The containment: what stopped this getting further, and when. Both are required before the case can be closed."
      />

      <Cols of={2}>
        <Field label="Immediate action date" htmlFor="dev-ia-date">
          <DateControl
            control={form.control}
            name="immediateActionDate"
            id="dev-ia-date"
          />
        </Field>
      </Cols>

      <Field
        label="Immediate action taken"
        htmlFor="dev-ia"
        error={form.formState.errors.immediateAction?.message}
      >
        <textarea
          id="dev-ia"
          rows={4}
          placeholder="e.g. Stock quarantined and returned for decanting, milling and compression."
          className={AREA}
          {...form.register("immediateAction")}
        />
      </Field>

      <SaveBar pending={form.formState.isSubmitting} />
    </form>
  );
}

/* ── Tab 3 · Risk assessment ──────────────────────────────────────────── */

export function RiskTab({
  deviation,
  factoryId,
  readOnly,
}: {
  deviation: Deviation;
  factoryId: string;
  readOnly: boolean;
}) {
  const form = useForm<RiskValues>({
    resolver: zodResolver(riskSchema),
    defaultValues: {
      likelihood: (deviation.likelihood?.toString() ??
        "") as RiskValues["likelihood"],
      severity: (deviation.severity?.toString() ??
        "") as RiskValues["severity"],
      detection: (deviation.detection?.toString() ??
        "") as RiskValues["detection"],
      financialImpact:
        deviation.financial_impact === null
          ? ""
          : deviation.financial_impact
            ? "yes"
            : "no",
      riskDescription: deviation.risk_description ?? "",
    },
  });

  const save = useTabSave<RiskValues>(
    factoryId,
    (values) => saveRisk(deviation.id, values),
    "Risk assessment saved.",
  );

  // The conclusion, as the three scores are picked — the same arithmetic the
  // view does, so the form and the register cannot disagree.
  const likelihood = useWatch({ control: form.control, name: "likelihood" });
  const severity = useWatch({ control: form.control, name: "severity" });
  const detection = useWatch({ control: form.control, name: "detection" });
  const live = riskOf(
    likelihood ? Number(likelihood) : null,
    severity ? Number(severity) : null,
    detection ? Number(detection) : null,
  );

  if (readOnly) {
    return (
      <div className="space-y-4">
        <RiskConclusionCard
          score={deviation.risk_score}
          conclusion={deviation.risk_conclusion}
          slaDate={deviation.sla_date}
        />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact label="Likelihood">
            {scaleLabel("likelihood", deviation.likelihood) ?? <Muted>—</Muted>}
          </Fact>
          <Fact label="Severity of impact">
            {scaleLabel("severity", deviation.severity) ?? <Muted>—</Muted>}
          </Fact>
          <Fact label="Probability of detection">
            {scaleLabel("detection", deviation.detection) ?? <Muted>—</Muted>}
          </Fact>
          <Fact label="Financial impact">
            {deviation.financial_impact === null ? (
              <Muted>Not answered</Muted>
            ) : deviation.financial_impact ? (
              "Yes"
            ) : (
              "No"
            )}
          </Fact>
          {deviation.risk_description && (
            <Fact label="Risk description" wide>
              {deviation.risk_description}
            </Fact>
          )}
        </dl>
      </div>
    );
  }

  return (
    <form
      onSubmit={form.handleSubmit((v) => save.mutateAsync(v).catch(() => {}))}
      className="space-y-4"
    >
      <Intro
        title="How bad, how likely, how visible"
        body="Three scores from 1 to 5, multiplied into the conclusion the register is read by. For each, 1 is the lowest risk — for detection that means an existing check always catches it."
      />

      <Cols>
        {(["likelihood", "severity", "detection"] as const).map((scale) => (
          <Field
            key={scale}
            label={RISK_SCALES[scale].label}
            htmlFor={`dev-${scale}`}
          >
            <SelectControl
              control={form.control}
              name={scale}
              id={`dev-${scale}`}
              clearable
              clearLabel="Not assessed"
              placeholder="Not assessed"
              options={RISK_SCALES[scale].options}
            />
          </Field>
        ))}
      </Cols>

      <RiskConclusionCard
        score={live?.score ?? null}
        conclusion={live?.conclusion ?? null}
        slaDate={deviation.sla_date}
        live
      />

      <Cols of={2}>
        <Field label="Financial impact" htmlFor="dev-financial">
          <YesNo control={form.control} name="financialImpact" />
        </Field>
      </Cols>

      <Field label="Risk description" htmlFor="dev-risk-desc" note="(optional)">
        <textarea
          id="dev-risk-desc"
          rows={3}
          placeholder="What the risk is, and to whom."
          className={AREA}
          {...form.register("riskDescription")}
        />
      </Field>

      <SaveBar pending={form.formState.isSubmitting} />
    </form>
  );
}

/**
 * The calculation, laid out as the reference QMS shows it: the score, the
 * risk it comes to, the case's due date beside them, and the rule in words.
 */
function RiskConclusionCard({
  score,
  conclusion,
  slaDate,
  live,
}: {
  score: number | null;
  conclusion: "Low" | "Medium" | "High" | null;
  slaDate: string | null;
  live?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-line bg-sunken px-4 py-3.5">
      <div>
        <p className="text-[0.6875rem] text-ink-5">Score</p>
        <p className="mt-0.5 text-xl font-semibold tabular-nums text-ink">
          {score ?? "—"}
        </p>
      </div>
      <div>
        <p className="text-[0.6875rem] text-ink-5">Risk</p>
        <p
          className={cn(
            "mt-0.5 text-xl font-semibold",
            conclusion ? RISK_TEXT[conclusion] : "text-ink-5",
          )}
        >
          {conclusion ?? "—"}
        </p>
      </div>
      <div>
        {/* Every case form calls it the due date now. */}
        <p className="text-[0.6875rem] text-ink-5">Due date</p>
        <p className="mt-0.5 text-xl font-semibold tabular-nums text-ink">
          {formatDate(slaDate)}
        </p>
      </div>
      <p className="max-w-sm text-[0.75rem] leading-relaxed text-ink-4">
        {score === null && live
          ? "Pick all three scores to see the risk. "
          : null}
        Score = severity × likelihood × detection. 20+ is Medium, 60+ is High.
        Severity 5 is always High.
      </p>
    </div>
  );
}

/* ── Tab 4 · Investigation ────────────────────────────────────────────── */

export function InvestigationTab({
  deviation,
  factoryId,
  readOnly,
}: {
  deviation: Deviation;
  factoryId: string;
  readOnly: boolean;
}) {
  const form = useForm<InvestigationValues>({
    resolver: zodResolver(investigationSchema),
    defaultValues: {
      investigationFindings: deviation.investigation_findings ?? "",
      rootCauseCategory: (deviation.root_cause_category ??
        "") as InvestigationValues["rootCauseCategory"],
      rootCause: deviation.root_cause ?? "",
      rcaMethod: (deviation.rca_method ?? "") as InvestigationValues["rcaMethod"],
    },
  });

  const save = useTabSave<InvestigationValues>(
    factoryId,
    (values) => saveInvestigation(deviation.id, values),
    "Investigation findings saved.",
  );

  if (readOnly) {
    return (
      <dl className="grid gap-3">
        <Fact label="Investigation findings" wide>
          {deviation.investigation_findings ?? <Muted>Not recorded</Muted>}
        </Fact>
        <Fact label="Root cause" wide>
          {deviation.root_cause ?? <Muted>Not recorded</Muted>}
        </Fact>
        <Fact label="Method">{deviation.rca_method ?? <Muted>—</Muted>}</Fact>
        <Fact label="Root cause category">
          {deviation.root_cause_category ?? <Muted>—</Muted>}
        </Fact>
      </dl>
    );
  }

  return (
    <form
      onSubmit={form.handleSubmit((v) => save.mutateAsync(v).catch(() => {}))}
      className="space-y-4"
    >
      <Intro
        title="What the investigation found"
        body="The root cause as far as it is known, and what the evidence was. Required before the case can be closed."
      />
      <Field
        label="Investigation findings"
        htmlFor="dev-findings"
        error={form.formState.errors.investigationFindings?.message}
      >
        <textarea
          id="dev-findings"
          rows={7}
          placeholder="e.g. Tablet breaking down to powder. The silica insert reduces water activity, pulling moisture from the tablets; the PET bottle's poor moisture barrier exacerbates the drying effect."
          className={AREA}
          {...form.register("investigationFindings")}
        />
      </Field>
      {/* Root cause analysis — here, where the cause is found, rather than
          on the CAPA (0061). */}
      <Group title="Root cause analysis">
        <div className="grid gap-3 lg:grid-cols-3">
          <Field
            label="Root cause"
            htmlFor="dev-root-cause"
            note="(optional)"
            className="lg:col-span-2"
          >
            <textarea
              id="dev-root-cause"
              rows={2}
              placeholder="Can be completed once the investigation finishes"
              className={AREA}
              {...form.register("rootCause")}
            />
          </Field>
          <Field label="Method" htmlFor="dev-rca-method" note="(optional)">
            <SelectControl
              control={form.control}
              name="rcaMethod"
              id="dev-rca-method"
              clearable
              clearLabel="Not chosen"
              placeholder="5-Why, Fishbone…"
              options={RCA_METHODS.map((m) => ({ value: m, label: m }))}
            />
          </Field>
        </div>
      </Group>
      <Cols>
        <Field
          label="Root cause category"
          htmlFor="dev-rc-category"
          note="(optional)"
        >
          <SelectControl
            control={form.control}
            name="rootCauseCategory"
            id="dev-rc-category"
            clearable
            clearLabel="Not categorised"
            placeholder="Man, method, material…"
            options={ROOT_CAUSE_CATEGORIES.map((c) => ({ value: c, label: c }))}
          />
        </Field>
      </Cols>
      <SaveBar pending={form.formState.isSubmitting} />
    </form>
  );
}

/* ── Tabs 5 & 6 · Corrective and preventive action ────────────────────── */

export function ActionPlanTab({
  deviation,
  factoryId,
  kind,
  readOnly,
}: {
  deviation: Deviation;
  factoryId: string;
  kind: "ca" | "pa";
  readOnly: boolean;
}) {
  const corrective = kind === "ca";
  const label = corrective ? "Corrective action" : "Preventive action";
  const values = corrective
    ? {
        owner: deviation.ca_owner,
        target: deviation.ca_target_date,
        closed: deviation.ca_closed_date,
        closedBy: deviation.ca_closed_by_name,
        description: deviation.ca_description,
      }
    : {
        owner: deviation.pa_owner,
        target: deviation.pa_target_date,
        closed: deviation.pa_closed_date,
        closedBy: deviation.pa_closed_by_name,
        description: deviation.pa_description,
      };

  const { data: workers = [] } = useWorkers(factoryId);
  const form = useForm<ActionPlanValues>({
    resolver: zodResolver(actionPlanSchema),
    defaultValues: {
      owner: values.owner ?? "",
      targetDate: values.target ?? "",
      closedDate: values.closed ?? "",
      closedBy: values.closedBy ?? "",
      description: values.description ?? "",
    },
  });

  const save = useTabSave<ActionPlanValues>(
    factoryId,
    (v) => saveActionPlan(deviation.id, kind, v),
    `${label} saved.`,
  );

  if (readOnly) {
    return (
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label={`${corrective ? "CA" : "PA"} owner`}>
          {values.owner ?? <Muted>—</Muted>}
        </Fact>
        <Fact label="Target date">{formatDate(values.target)}</Fact>
        <Fact label="Actual closed date">{formatDate(values.closed)}</Fact>
        <Fact label="Closed by">{values.closedBy ?? <Muted>—</Muted>}</Fact>
        <Fact label="Description" wide>
          {values.description ?? <Muted>Nothing recorded</Muted>}
        </Fact>
      </dl>
    );
  }

  return (
    <form
      onSubmit={form.handleSubmit((v) => save.mutateAsync(v).catch(() => {}))}
      className="space-y-4"
    >
      <Intro
        title={corrective ? "Fixing this one" : "Stopping the next one"}
        body={
          corrective
            ? "What is being done about the batch and the cause in front of you."
            : "What changes so this does not come back — a procedure, a check, a supplier conversation."
        }
      />

      <Cols>
        <Field
          label={`${corrective ? "CA" : "PA"} owner`}
          htmlFor={`dev-${kind}-owner`}
        >
          <PersonControl
            control={form.control}
            name="owner"
            id={`dev-${kind}-owner`}
            workers={workers}
            label={`${corrective ? "CA" : "PA"} owner`}
            placeholder="Who owns it"
          />
        </Field>
        <Field label="Target date" htmlFor={`dev-${kind}-target`}>
          <DateControl
            control={form.control}
            name="targetDate"
            id={`dev-${kind}-target`}
          />
        </Field>
        <Field label="Actual closed date" htmlFor={`dev-${kind}-closed`}>
          <DateControl
            control={form.control}
            name="closedDate"
            id={`dev-${kind}-closed`}
          />
        </Field>
        <Field label="Closed by" htmlFor={`dev-${kind}-by`}>
          <input
            id={`dev-${kind}-by`}
            placeholder="Who signed it off"
            className={CONTROL}
            {...form.register("closedBy")}
          />
        </Field>
      </Cols>

      <Field
        label={`${corrective ? "CA" : "PA"} description`}
        htmlFor={`dev-${kind}-desc`}
        error={form.formState.errors.description?.message}
      >
        <textarea
          id={`dev-${kind}-desc`}
          rows={4}
          placeholder={
            corrective
              ? "e.g. Discontinue the silica insert for this product. Implement induction seal. Switch to HDPE packaging."
              : "e.g. Establish a moisture monitoring protocol during stability studies."
          }
          className={AREA}
          {...form.register("description")}
        />
      </Field>

      <SaveBar pending={form.formState.isSubmitting}>
        A case can be closed without one — say so in the close-out.
      </SaveBar>
    </form>
  );
}

/* ── Tab 7 · Close out ────────────────────────────────────────────────── */

export function CloseOutTab({
  deviation,
  factoryId,
  readOnly,
}: {
  deviation: Deviation;
  factoryId: string;
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const isNcr = deviation.type === "ncr";
  const gaps = outstanding(deviation);

  const { data: workers = [] } = useWorkers(factoryId);
  const form = useForm<CloseOutValues>({
    resolver: zodResolver(closeOutSchema),
    defaultValues: {
      isNcr,
      // The decision raised with carries over, unless it was the hold itself.
      disposition:
        deviation.disposition && deviation.disposition !== "quarantine"
          ? deviation.disposition
          : "",
      owner: deviation.co_owner ?? "",
      targetDate: deviation.co_target_date ?? "",
      description: "",
      statusReason: undefined,
      closedBy: deviation.qa_reviewer ?? "",
    },
  });

  const formRef = useRef<HTMLFormElement>(null);
  const close = useMutation({
    mutationFn: (values: CloseOutValues) => closeDeviation(deviation, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: deviationKeys.all(factoryId),
      });
      if (deviation.is_quarantining) {
        await queryClient.invalidateQueries({
          queryKey: pipelineKeys.all(factoryId),
        });
        toast.success(
          `${deviation.deviation_no} closed. ${deviation.batch_nos.length > 1 ? "Batches" : "Batch"} ${deviation.batch_nos.join(", ") || deviation.batch_no} ${deviation.batch_nos.length > 1 ? "stay" : "stays"} on hold until the next preparatory or production entry.`,
        );
      } else {
        toast.success(`${deviation.deviation_no} closed.`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const savePlan = useTabSave<{ owner: string; targetDate: string }>(
    factoryId,
    (v) => saveCloseOutPlan(deviation.id, v),
    "Close-out details saved.",
  );

  if (deviation.status === "closed") {
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-2xl border border-teal-line bg-teal-soft px-4 py-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-teal" />
          <div>
            <p className="text-sm font-semibold text-teal-deep">
              Closed by {deviation.qa_sign_name}
            </p>
            <p className="text-xs text-teal-deep/80">
              {deviation.closed_at && formatDateTime(deviation.closed_at)}
              {deviation.status_reason && ` · ${deviation.status_reason}`}
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact label="CO owner">{deviation.co_owner ?? <Muted>—</Muted>}</Fact>
          <Fact label="CO target date">
            {formatDate(deviation.co_target_date)}
          </Fact>
          <Fact label="Status reason">
            {deviation.status_reason ?? <Muted>—</Muted>}
          </Fact>
          <Fact label="CO description" wide>
            {deviation.closing_note ?? <Muted>—</Muted>}
          </Fact>
        </dl>
      </div>
    );
  }

  if (readOnly) {
    return (
      <div className="rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-10 text-center">
        <p className="text-sm text-ink-4">
          A supervisor or above closes this case with QA.
        </p>
        <p className="mt-1 text-xs text-ink-5">
          You can follow it here — the record updates as each tab is filled.
        </p>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={form.handleSubmit((v) => close.mutateAsync(v).catch(() => {}))}
      className="space-y-4"
    >
      <Intro
        title="Close the case"
        body="The close-out is the only gate: it needs the containment action, the risk assessment, the investigation findings and the CAPA decision — a CAPA verified as effective, or a reason none is needed. Once closed, the case cannot be edited."
      />

      {/* What the database will refuse the close for, named by its tab, so
          nobody hunts for it through seven of them. */}
      {gaps.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-warn-line bg-warn-tint px-4 py-3 text-xs text-warn-ink">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <p>
            Still needed before this can be closed:{" "}
            {gaps.map((g, i) => (
              // Keyed by what, not by tab: one tab can hold two gaps (a
              // complaint's adverse reaction and its immediate action).
              <span key={g.what}>
                {i > 0 && ", "}
                <span className="font-semibold">{g.what}</span>
              </span>
            ))}
            .
          </p>
        </div>
      )}

      {isNcr && (
        <Field
          label="Final disposition"
          required
          hint="Quarantine is a hold while QA decides — not an outcome a case can close on."
          error={form.formState.errors.disposition?.message}
        >
          <div className="grid gap-2 sm:grid-cols-3">
            {DISPOSITIONS.filter((d) => d.value !== "quarantine").map((d) => (
              <label
                key={d.value}
                className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-[0_1px_2px_rgb(20_22_43/0.04)] transition hover:border-line-strong has-[:checked]:border-brand has-[:checked]:bg-brand-tint has-[:checked]:ring-2 has-[:checked]:ring-brand/15"
              >
                <input
                  type="radio"
                  value={d.value}
                  {...form.register("disposition")}
                  className="mt-0.5 size-4 accent-brand"
                />
                <span>
                  <span className="block text-sm font-semibold text-ink">
                    {d.label}
                  </span>
                  <span className="block text-[0.6875rem] text-ink-5">
                    {d.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </Field>
      )}

      <Cols>
        <Field label="CO owner" htmlFor="dev-co-owner">
          <PersonControl
            control={form.control}
            name="owner"
            id="dev-co-owner"
            workers={workers}
            label="CO owner"
            placeholder="Who owns the close-out"
          />
        </Field>
        <Field label="CO target date" htmlFor="dev-co-target">
          <DateControl
            control={form.control}
            name="targetDate"
            id="dev-co-target"
          />
        </Field>
        <Field
          label="Status reason"
          htmlFor="dev-status-reason"
          required
          error={form.formState.errors.statusReason?.message}
        >
          <SelectControl
            control={form.control}
            name="statusReason"
            id="dev-status-reason"
            placeholder="Why it is being closed…"
            invalid={Boolean(form.formState.errors.statusReason)}
            options={STATUS_REASONS.map((r) => ({ value: r, label: r }))}
          />
        </Field>
      </Cols>

      <Field
        label="CO description"
        htmlFor="dev-co-desc"
        required
        error={form.formState.errors.description?.message}
      >
        <textarea
          id="dev-co-desc"
          rows={4}
          placeholder="e.g. Batch 44637 reworked as bulk WO45799 for milling and compression, and WO45800 for packing."
          aria-invalid={Boolean(form.formState.errors.description)}
          className={AREA}
          {...form.register("description")}
        />
      </Field>

      <Field
        label="CO closed by"
        htmlFor="dev-co-by"
        required
        hint="Typed, and stamped with the time — the equivalent of the signature box."
        error={form.formState.errors.closedBy?.message}
      >
        <input
          id="dev-co-by"
          placeholder="Name"
          aria-invalid={Boolean(form.formState.errors.closedBy)}
          className={CONTROL}
          {...form.register("closedBy")}
        />
      </Field>

      {/* In the dialog's fixed footer, beside Close. The submit is a plain
          button that submits this form by ref, because once portalled it is
          no longer inside the form in the DOM. */}
      <FooterActions>
        {/* The owner and target date are worth keeping before the case is
            ready to close, so they can be saved on their own. */}
        <button
          type="button"
          disabled={savePlan.isPending}
          onClick={() =>
            savePlan.mutate({
              owner: form.getValues("owner"),
              targetDate: form.getValues("targetDate"),
            })
          }
          className={SECONDARY_BUTTON}
        >
          {savePlan.isPending && <Loader2 className="size-4 animate-spin" />}
          Save without closing
        </button>

        <button
          type="button"
          onClick={() => formRef.current?.requestSubmit()}
          disabled={form.formState.isSubmitting || gaps.length > 0}
          title={
            gaps.length > 0
              ? "The tabs above still need filling in."
              : undefined
          }
          className={PRIMARY_BUTTON}
        >
          {form.formState.isSubmitting && (
            <Loader2 className="size-4 animate-spin" />
          )}
          Close {deviation.deviation_no}
        </button>
      </FooterActions>
    </form>
  );
}

/* ── Shared ───────────────────────────────────────────────────────────── */

function Intro({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-4">{body}</p>
    </div>
  );
}
