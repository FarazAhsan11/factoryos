"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { Loader2, Plus, Wrench } from "lucide-react";
import { toast } from "sonner";

import {
  maintenanceRequestSchema,
  type MaintenanceRequestValues,
} from "@/app/factory/[slug]/maintenance/schemas";
import { BatchSummary } from "@/components/factory/batch/batch-summary";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MAINTENANCE_PRIORITIES,
  createMaintenanceRequest,
} from "@/lib/factory/maintenance-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";
import { cn } from "@/lib/utils";

const CONTROL =
  "h-10 w-full rounded-xl border border-line bg-sunken px-3.5 text-sm text-ink outline-none transition placeholder:text-ink-5 focus:border-brand focus:bg-surface";

const EMPTY: MaintenanceRequestValues = {
  equipmentNo: "",
  unitId: "",
  departmentId: "",
  initiatingDepartmentId: "",
  priority: "routine",
  description: "",
  batchNo: "",
  reportedBy: "",
};

/**
 * Raise a maintenance request.
 *
 * Two deliberate departures from the prototype's version of this form:
 *
 *  · **Department, not issue type.** The prototype asks what kind of fault it
 *    is — mechanical, electrical, pneumatic. What actually has to be recorded
 *    is *who is needed*, and which trades a plant keeps in-house differ, so
 *    the list is managed in Admin rather than hard-coded here.
 *
 *  · **The batch is typed.** Same as the shift log: the number is on the
 *    paperwork in front of whoever found the fault. A dropdown of open batches
 *    is slower to use and stops working the moment the batch isn't on the
 *    pipeline board — which, for a machine that broke mid-run, it may not be.
 */
export function NewMaintenanceDialog({
  factoryId,
  userId,
  unitWord,
  onCreated,
}: {
  factoryId: string;
  userId: string;
  unitWord: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);

  const { data: units = [] } = useQuery({
    queryKey: setupKeys.all("factory_units", factoryId),
    queryFn: () => fetchSetupItems("factory_units", factoryId),
  });
  const { data: departments = [] } = useQuery({
    queryKey: setupKeys.all("factory_departments", factoryId),
    queryFn: () => fetchSetupItems("factory_departments", factoryId),
  });
  // The whole catalogue, matched in the browser — the same approach the log
  // form takes, and the reason typing a batch resolves without a round-trip.
  const { data: products = [] } = useQuery({
    queryKey: productKeys.all(factoryId),
    queryFn: () => fetchProducts(factoryId),
  });

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<MaintenanceRequestValues>({
    resolver: zodResolver(maintenanceRequestSchema),
    defaultValues: EMPTY,
  });

  const batchNo = useWatch({ control, name: "batchNo" });

  const matched = useMemo(() => {
    const term = (batchNo ?? "").trim().toLowerCase();
    if (!term) return null;
    return products.find((p) => p.batch_no.toLowerCase() === term) ?? null;
  }, [products, batchNo]);

  const create = useMutation({
    mutationFn: (values: MaintenanceRequestValues) =>
      createMaintenanceRequest(factoryId, values, userId, matched?.id ?? null),
    onSuccess: () => {
      reset(EMPTY);
      setOpen(false);
      onCreated();
      toast.success("Maintenance request raised.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeUnits = units.filter((u) => u.active);
  const activeDepartments = departments.filter((d) => d.active);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset(EMPTY);
          setOpen(true);
        }}
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-3.5 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06]"
      >
        <Plus className="size-4" />
        New request
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && create.isPending) return;
          setOpen(next);
        }}
      >
        <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-ink">
              <Wrench className="size-4 text-brand" />
              New maintenance request
            </DialogTitle>
            <DialogDescription>
              Section 1 of the request. Engineering and QA sign the other two
              once this one is raised.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={handleSubmit((values) => create.mutate(values))}
            className="space-y-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Equipment no."
                htmlFor="mr-eq"
                required
                error={errors.equipmentNo?.message}
              >
                <input
                  id="mr-eq"
                  autoFocus
                  placeholder="e.g. EQ296"
                  aria-invalid={Boolean(errors.equipmentNo)}
                  className={cn(CONTROL, "font-mono")}
                  {...register("equipmentNo")}
                />
              </Field>

              <Field
                label={`${unitWord} / line`}
                htmlFor="mr-unit"
                note="(optional)"
              >
                <select
                  id="mr-unit"
                  className={CONTROL}
                  {...register("unitId")}
                >
                  <option value="">
                    Not {unitWord.toLowerCase()}-specific
                  </option>
                  {activeUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Department needed" htmlFor="mr-dept">
                <select
                  id="mr-dept"
                  className={CONTROL}
                  disabled={activeDepartments.length === 0}
                  {...register("departmentId")}
                >
                  <option value="">
                    {activeDepartments.length === 0
                      ? "None set up yet"
                      : "Select department…"}
                  </option>
                  {activeDepartments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                {/* Says where the list comes from rather than silently
                    offering an empty dropdown — the fix is one tab away. */}
                {activeDepartments.length === 0 && (
                  <p className="mt-1 text-[11px] text-ink-5">
                    Add them in Admin &amp; Settings → Departments.
                  </p>
                )}
              </Field>

              <Field label="Priority" htmlFor="mr-priority">
                <select
                  id="mr-priority"
                  className={CONTROL}
                  {...register("priority")}
                >
                  {MAINTENANCE_PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label} — {p.hint}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field
              label="Issue description"
              htmlFor="mr-description"
              required
              error={errors.description?.message}
            >
              <textarea
                id="mr-description"
                rows={3}
                placeholder="Describe the fault, what was happening, when it started…"
                aria-invalid={Boolean(errors.description)}
                className="w-full rounded-xl border border-line bg-sunken px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-5 focus:border-brand focus:bg-surface"
                {...register("description")}
              />
            </Field>

            <Field label="Affected batch" htmlFor="mr-batch" note="(optional)">
              <input
                id="mr-batch"
                placeholder="Type a batch number"
                className={cn(CONTROL, "font-mono")}
                {...register("batchNo")}
              />
              <div className="mt-1.5">
                <BatchSummary factoryId={factoryId} batchNo={batchNo ?? ""} />
              </div>
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Reported by"
                htmlFor="mr-reported"
                note="(optional)"
              >
                <input
                  id="mr-reported"
                  placeholder="Your name"
                  className={CONTROL}
                  {...register("reportedBy")}
                />
              </Field>

              {/* "Initiating Department" on the paper form — who is raising
                  it, as opposed to who is needed. Two different questions that
                  the same dropdown answers, so they sit apart on the form. */}
              <Field
                label="Initiating department"
                htmlFor="mr-initiating"
                note="(optional)"
              >
                <select
                  id="mr-initiating"
                  className={CONTROL}
                  disabled={activeDepartments.length === 0}
                  {...register("initiatingDepartmentId")}
                >
                  <option value="">
                    {activeDepartments.length === 0
                      ? "None set up yet"
                      : "Select department…"}
                  </option>
                  {activeDepartments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
                className="h-10 rounded-xl px-4 text-sm font-medium text-ink-3 transition hover:bg-sunken-2 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
              >
                {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                Submit request
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({
  label,
  htmlFor,
  note,
  required,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  note?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-3">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
        {note && <span className="ml-1 text-[10px] text-ink-5">{note}</span>}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-[11.5px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
