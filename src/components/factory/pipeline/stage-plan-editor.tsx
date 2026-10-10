"use client";

import { useState } from "react";
import {
  Controller,
  useFieldArray,
  useWatch,
  type UseFormReturn,
} from "react-hook-form";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Flag,
  ListChecks,
  Plus,
  Rocket,
  X,
} from "lucide-react";

import {
  STAGE_UNITS,
  type StageDraftValues,
  type StagePlanParsed,
  type StagePlanValues,
  type StageUnit,
} from "@/app/factory/[slug]/pipeline/schemas";
import { DateField } from "@/components/ui/date-picker";
import {
  CONTROL,
  Cell,
  ColumnHeads,
  HEAD,
  INPUT,
  ROW_COLS,
  ROW_COLS_WO,
  RoutePills,
} from "@/components/factory/pipeline/stage-table-parts";
import { SelectField } from "@/components/ui/select-field";
import { cn } from "@/lib/utils";

type PlanForm = UseFormReturn<StagePlanValues, unknown, StagePlanParsed>;

/**
 * A batch's stage plan, written before the batch exists — the Stages block in
 * New batch.
 *
 * The same route the plan dialog builds one stage at a time, as a list of
 * rows. Given room (the container is at least `@3xl`, 48rem) a stage is **one
 * line** — activity, room, start, end, target, unit — under a single header
 * row, which is what lets a five-stage route be read at a glance instead of
 * scrolled. Narrower than that, the same fields wrap onto a second line and
 * carry their own labels. The dialog is widened to give New batch the room;
 * the fields above the plan are held to their old width so they don't stretch
 * with it.
 *
 * Nothing here is saved until the whole dialog is. The rows are a field array
 * on their own form (`stagePlanSchema`), validated beside the batch, so one
 * submit either raises the batch with its plan or raises nothing. The last row
 * completes the order, as everywhere else: position, not a flag, so reordering
 * moves it.
 */
export function StagePlanEditor({
  form,
  idPrefix,
  processes,
  rooms,
  showWorkOrder,
  defaultUnit,
  orderLabel,
  disabled,
}: {
  form: PlanForm;
  /** Keeps ids unique when two plans share the dialog. */
  idPrefix: string;
  /** Plannable activities — never downtime. */
  processes: { id: string; name: string; category: string | null }[];
  rooms: { id: string; name: string }[];
  /** Only a company tracking work orders per stage is asked for one. */
  showWorkOrder: boolean;
  /** What a new row counts in — the batch's own unit. */
  defaultUnit: StageUnit;
  /** "40,000 boxes" — what the last stage is measured against. */
  orderLabel?: string | null;
  disabled?: boolean;
}) {
  const { control, register, formState } = form;
  const errors = formState.errors;
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: "stages",
  });
  const rows = useWatch({ control, name: "stages" }) ?? [];
  const issue = useWatch({ control, name: "issue" });

  // The route reads as pills; the rows behind them are the detail. Closed until
  // asked for — except when a row has something to say (a failed submit), which
  // must not stay hidden, and when a stage has just been added.
  const [expanded, setExpanded] = useState(false);
  const open = expanded || Boolean(errors.stages);
  const rowsId = `${idPrefix}-rows`;
  const processNames = new Map(processes.map((p) => [p.id, p]));

  // An activity that appears twice needs a label on each run; the field only
  // appears once it is needed.
  const repeated = new Set(
    rows
      .map((r) => r.processId)
      .filter((id, i, all) => id && all.indexOf(id) !== i),
  );

  function addRow() {
    const row: StageDraftValues = {
      processId: "",
      unitId: "",
      plannedDate: "",
      estFinishDate: "",
      targetQty: undefined,
      targetUnit: defaultUnit,
      label: "",
      workOrder: "",
      canRunParallel: false,
    };
    append(row);
    setExpanded(true);
  }

  return (
    // A container, so the rows lay out by the width they are given — the
    // dialog's — rather than by the screen's.
    // Spaced child by child, not with `space-y`: the rows are animated to zero
    // height, and a collapsed child would still be given its gap.
    <section className="@container">
      <div>
        <p className="flex items-center gap-1.5 text-[0.6875rem] font-bold tracking-[0.04em] text-ink-2 uppercase">
          <ListChecks className="size-3.5" aria-hidden />
          Stages
          {fields.length > 0 && (
            <span className="rounded-full bg-sunken-2 px-1.5 py-0.5 text-[0.625rem] text-ink-4">
              {fields.length}
            </span>
          )}
        </p>
        <p className="mt-0.5 text-[0.6875rem] text-ink-5">
          Rooms and dates can be left blank and scheduled later. The last stage
          completes the order{orderLabel ? ` — ${orderLabel}` : ""}.
        </p>
      </div>

      {fields.length > 0 && (
        <>
          <RoutePills
            className="mt-2.5"
            steps={fields.map((field, index) => {
              const row = rows[index];
              const proc = row?.processId
                ? processNames.get(row.processId)
                : undefined;
              return {
                key: field.id,
                name: proc?.name ?? row?.templateName ?? "Pick the activity",
                runLabel: row?.label?.trim() || undefined,
                unresolved: !proc,
                error: Boolean(errors.stages?.[index]),
              };
            })}
          />

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={open}
            aria-controls={rowsId}
            className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-lg px-1 text-xs font-semibold text-brand transition hover:text-brand-deep"
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", open && "rotate-90")}
              aria-hidden
            />
            Customise stages
          </button>
        </>
      )}

      {fields.length === 0 ? (
        <div className="mt-2.5 rounded-xl border border-dashed border-line-strong bg-surface px-4 py-4 text-center">
          <p className="text-xs text-ink-5">
            No stages yet. Add them now, or plan them later from the board.
          </p>
          <button
            type="button"
            onClick={addRow}
            disabled={disabled}
            className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink-3 transition hover:border-brand hover:bg-brand-tint hover:text-brand disabled:opacity-50"
          >
            <Plus className="size-3.5" aria-hidden />
            Add stage
          </button>
        </div>
      ) : (
        // Opens by animating its row track from 0fr to 1fr — the one way to
        // transition to an auto height. `inert` keeps the hidden fields out of
        // the tab order and the accessibility tree while it is closed.
        <div
          id={rowsId}
          inert={!open}
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
            open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
        <div className="min-h-0 overflow-hidden">
        <div className="pt-2.5">
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <ColumnHeads showWorkOrder={showWorkOrder} />
          <ol className="divide-y divide-line-soft">
            {fields.map((field, index) => {
              const rowErrors = errors.stages?.[index];
              const isLast = index === fields.length - 1;
              // A route stage this factory has no activity for: the row keeps
              // its place in the route and says what belongs there.
              const missing = !rows[index]?.processId
                ? rows[index]?.templateName
                : undefined;
              const needsLabel =
                repeated.has(rows[index]?.processId ?? "") ||
                Boolean(rowErrors?.label);
              const messages = [
                rowErrors?.processId?.message,
                rowErrors?.targetQty?.message,
                rowErrors?.targetUnit?.message,
                rowErrors?.estFinishDate?.message,
                rowErrors?.label?.message,
                rowErrors?.workOrder?.message,
              ].filter(Boolean);

              return (
                <li
                  key={field.id}
                  className={cn(
                    "flex gap-2.5 px-3 py-2.5",
                    messages.length > 0 && "bg-danger-soft/40",
                  )}
                >
                  {/* Position and order. The flag marks the stage that
                      completes the order — the last one. */}
                  <div className="flex shrink-0 flex-col items-center gap-1 pt-5 @3xl:h-9 @3xl:flex-row @3xl:gap-0.5 @3xl:pt-0">
                    <span
                      title={isLast ? "Completes the order" : `Stage ${index + 1}`}
                      className={cn(
                        "grid size-6 place-items-center rounded-md font-mono text-[0.6875rem] font-bold",
                        isLast
                          ? "bg-teal-soft text-teal-deep"
                          : "bg-sunken-2 text-ink-4",
                      )}
                    >
                      {isLast ? <Flag className="size-3" /> : index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => move(index, index - 1)}
                      disabled={disabled || index === 0}
                      aria-label="Move up"
                      className="grid size-5 place-items-center rounded text-ink-5 transition hover:bg-sunken-2 hover:text-ink disabled:opacity-25"
                    >
                      <ArrowUp className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, index + 1)}
                      disabled={disabled || isLast}
                      aria-label="Move down"
                      className="grid size-5 place-items-center rounded text-ink-5 transition hover:bg-sunken-2 hover:text-ink disabled:opacity-25"
                    >
                      <ArrowDown className="size-3" />
                    </button>
                  </div>

                  <div className="min-w-0 flex-1 space-y-2">
                    {/* The stage. One line at @3xl; otherwise what and where
                        take a line each and the rest wrap in pairs. */}
                    <div
                      className={cn(
                        "grid grid-cols-2 gap-2",
                        showWorkOrder ? ROW_COLS_WO : ROW_COLS,
                      )}
                    >
                      <Cell label="Activity" wide>
                        <Controller
                          name={`stages.${index}.processId`}
                          control={control}
                          render={({ field: f }) => (
                            <SelectField
                              id={`${idPrefix}-process-${index}`}
                              value={f.value ?? ""}
                              onChange={f.onChange}
                              onBlur={f.onBlur}
                              disabled={disabled}
                              ariaInvalid={Boolean(rowErrors?.processId)}
                              placeholder={
                                missing ? `${missing} — pick…` : "Pick the activity…"
                              }
                              searchPlaceholder="Activity name…"
                              emptyMessage="No activity matches that."
                              className={CONTROL}
                              options={processes.map((proc) => ({
                                value: proc.id,
                                label: proc.name,
                                meta: proc.category ?? undefined,
                              }))}
                            />
                          )}
                        />
                      </Cell>
                      <Cell label="Room" wide>
                        <Controller
                          name={`stages.${index}.unitId`}
                          control={control}
                          render={({ field: f }) => (
                            <SelectField
                              id={`${idPrefix}-room-${index}`}
                              value={f.value ?? ""}
                              onChange={f.onChange}
                              onBlur={f.onBlur}
                              disabled={disabled}
                              clearable
                              clearLabel="Not assigned"
                              placeholder="Not assigned"
                              className={CONTROL}
                              options={rooms.map((r) => ({
                                value: r.id,
                                label: r.name,
                              }))}
                            />
                          )}
                        />
                      </Cell>
                      {showWorkOrder && (
                        <Cell label="Work order" wide>
                          <input
                            id={`${idPrefix}-wo-${index}`}
                            placeholder="—"
                            autoComplete="off"
                            disabled={disabled}
                            className={cn(INPUT, "font-mono tracking-tight")}
                            {...register(`stages.${index}.workOrder`)}
                          />
                        </Cell>
                      )}
                      <Cell label="Start">
                        <Controller
                          name={`stages.${index}.plannedDate`}
                          control={control}
                          render={({ field: f }) => (
                            <DateField
                              id={`${idPrefix}-start-${index}`}
                              value={f.value ?? ""}
                              onChange={f.onChange}
                              disabled={disabled}
                              placeholder="—"
                              className={CONTROL}
                            />
                          )}
                        />
                      </Cell>
                      <Cell label="End">
                        <Controller
                          name={`stages.${index}.estFinishDate`}
                          control={control}
                          render={({ field: f }) => (
                            <DateField
                              id={`${idPrefix}-end-${index}`}
                              value={f.value ?? ""}
                              onChange={f.onChange}
                              disabled={disabled}
                              ariaInvalid={Boolean(rowErrors?.estFinishDate)}
                              placeholder="—"
                              className={CONTROL}
                            />
                          )}
                        />
                      </Cell>
                      <Cell label="Target">
                        <input
                          id={`${idPrefix}-target-${index}`}
                          type="number"
                          step="any"
                          min={0}
                          placeholder="—"
                          disabled={disabled}
                          aria-invalid={Boolean(rowErrors?.targetQty) || undefined}
                          className={cn(INPUT, "font-mono tracking-tight")}
                          {...register(`stages.${index}.targetQty`, {
                            valueAsNumber: true,
                          })}
                        />
                      </Cell>
                      <Cell label="Unit">
                        <Controller
                          name={`stages.${index}.targetUnit`}
                          control={control}
                          render={({ field: f }) => (
                            <SelectField
                              id={`${idPrefix}-unit-${index}`}
                              value={f.value ?? ""}
                              onChange={f.onChange}
                              onBlur={f.onBlur}
                              disabled={disabled}
                              searchable={false}
                              className={CONTROL}
                              options={STAGE_UNITS.map((u) => ({
                                value: u,
                                label: u,
                              }))}
                            />
                          )}
                        />
                      </Cell>
                    </div>

                    {/* The two occasional answers: a label, only when the
                        activity runs twice in this plan — the one case its
                        name alone cannot tell apart — and whether the stage
                        may overlap the one before it. */}
                    {(needsLabel || index > 0) && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        {needsLabel && (
                          <span className="flex items-center gap-2">
                            <label
                              htmlFor={`${idPrefix}-label-${index}`}
                              className={HEAD}
                            >
                              Run label
                            </label>
                            <input
                              id={`${idPrefix}-label-${index}`}
                              placeholder="e.g. 30's"
                              disabled={disabled}
                              aria-invalid={Boolean(rowErrors?.label) || undefined}
                              className={cn(INPUT, "h-8 w-36")}
                              {...register(`stages.${index}.label`)}
                            />
                          </span>
                        )}
                        {index > 0 && (
                          <label className="flex cursor-pointer items-center gap-2 text-[0.6875rem] text-ink-4">
                            <input
                              type="checkbox"
                              disabled={disabled}
                              className="size-3.5 accent-[var(--color-brand)]"
                              {...register(`stages.${index}.canRunParallel`)}
                            />
                            Can start before the previous stage finishes
                          </label>
                        )}
                      </div>
                    )}

                    {missing && (
                      <p className="text-[0.6875rem] text-warn-ink">
                        No &ldquo;{missing}&rdquo; activity in Plant setup →
                        Process stages. Add it there, pick the activity it is
                        called here, or remove this stage.
                      </p>
                    )}

                    {messages.length > 0 && (
                      <p role="alert" className="text-[0.6875rem] text-danger-deep">
                        {messages.join(" · ")}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => remove(index)}
                    disabled={disabled}
                    aria-label={`Remove stage ${index + 1}`}
                    className="mt-5 grid size-8 shrink-0 place-items-center rounded-lg text-ink-6 transition hover:bg-danger-soft hover:text-danger-deep @3xl:mt-0.5"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="border-t border-line-soft bg-sunken/60 px-3 py-2">
            <button
              type="button"
              onClick={addRow}
              disabled={disabled}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-ink-4 transition hover:bg-brand-tint hover:text-brand disabled:opacity-50"
            >
              <Plus className="size-3.5" aria-hidden />
              Add stage
            </button>
          </div>
        </div>
        </div>
        </div>
        </div>
      )}

      {/* Issuing is what lets the floor log against the batch. Offered here so
          a batch whose plan is already known goes from nothing to on the floor
          in one sitting; it costs a target on every stage, which the rows
          above are checked for before anything is saved. */}
      <label
        className={cn(
          "mt-2.5 flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 transition select-none",
          issue
            ? "border-teal-line bg-teal-soft text-teal-deep"
            : "border-line bg-surface text-ink-3 hover:border-line-strong",
          errors.issue && "border-danger-line",
        )}
      >
        <input
          type="checkbox"
          disabled={disabled}
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-teal)]"
          {...register("issue")}
        />
        <span>
          <span className="flex items-center gap-1.5 text-[0.7812rem] font-semibold">
            <Rocket className="size-3.5" aria-hidden />
            Issue for production when added
          </span>
          <span className="mt-0.5 block text-[0.6875rem] font-normal opacity-80">
            Operators can log against it straight away. Every stage needs a
            target.
          </span>
          {errors.issue?.message && (
            <span role="alert" className="mt-1 block text-[0.6875rem] text-danger-deep">
              {errors.issue.message}
            </span>
          )}
        </span>
      </label>
    </section>
  );
}

export function emptyPlan(): StagePlanValues {
  return { stages: [], issue: false };
}
