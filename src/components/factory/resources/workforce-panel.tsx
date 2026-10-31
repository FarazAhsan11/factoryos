"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Check,
  HardHat,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  EMPTY_WORKER,
  SHIFT_LABELS,
  SHIFT_SLOTS,
  workerSchema,
  type WorkerValues,
} from "@/app/factory/[slug]/admin/schemas";
import {
  Composer,
  EmptyState,
  FIELD,
  PANEL,
  PanelHeader,
} from "@/components/factory/admin/settings-ui";
import { WorkerBulkDialog } from "@/components/factory/resources/worker-bulk-dialog";
import { SelectField, type SelectOption } from "@/components/ui/select-field";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";
import {
  createWorker,
  deleteWorker,
  updateWorker,
  useWorkers,
  workerKeys,
  workerValues,
  type Worker,
} from "@/lib/factory/worker-queries";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";

const LABEL = "text-xs font-medium text-ink-3";
const CELL_INPUT =
  "h-8 w-full rounded-lg border border-line bg-surface px-2 text-sm text-ink outline-none focus:border-brand aria-invalid:border-danger";

const SHIFT_OPTIONS: SelectOption[] = SHIFT_SLOTS.map((s) => ({
  value: s,
  label: SHIFT_LABELS[s],
}));

/**
 * Resources → Workforce: the people who perform and are assigned work
 * (`factory_workers`, migration 0053) — the shift log's operators, and the
 * names every other "who" field picks from. Not the logins: those are
 * Configuration → Users, and most of the people here never sign in.
 *
 * The equipment register's shape: browser-direct under RLS, optimistic edits,
 * filtered in the client because the whole register is already cached. Add
 * one person at a time in the composer, or a whole team with Bulk add.
 */
export function WorkforcePanel({
  factoryId,
  canManage,
}: {
  factoryId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = workerKeys.all(factoryId);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: workers = [], isPending, isError, error } = useWorkers(factoryId);
  const { data: departments = [] } = useQuery({
    queryKey: setupKeys.all("factory_departments", factoryId),
    queryFn: () => fetchSetupItems("factory_departments", factoryId),
  });

  // Every department names its rows, retired ones included; only the ones
  // still in use can be chosen for someone.
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));
  const activeDepartments = departments.filter((d) => d.active);
  const departmentOptions: SelectOption[] = activeDepartments.map((d) => ({
    value: d.id,
    label: d.name,
  }));

  function refresh() {
    return queryClient.invalidateQueries({ queryKey });
  }

  const add = useMutation({
    mutationFn: (values: WorkerValues) => createWorker(factoryId, values),
    onSuccess: async (created) => {
      await refresh();
      toast.success(`${created.full_name} added to the workforce.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const edit = useMutation({
    mutationFn: ({ id, values }: { id: string; values: WorkerValues }) =>
      updateWorker(id, values),
    onMutate: async ({ id, values }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Worker[]>(queryKey);
      queryClient.setQueryData<Worker[]>(queryKey, (old) =>
        (old ?? []).map((w) =>
          w.id === id
            ? {
                ...w,
                full_name: values.fullName,
                department_id: values.departmentId || null,
                shift: values.shift,
                role: values.role,
              }
            : w,
        ),
      );
      return { previous };
    },
    onError: (e: Error, _vars, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
      toast.error(e.message);
    },
    onSuccess: () => setEditingId(null),
    onSettled: () => refresh(),
  });

  const remove = useMutation({
    mutationFn: (worker: Worker) => deleteWorker(worker.id),
    onMutate: async (worker) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Worker[]>(queryKey);
      queryClient.setQueryData<Worker[]>(queryKey, (old) =>
        (old ?? []).filter((w) => w.id !== worker.id),
      );
      return { previous };
    },
    onError: (e: Error, _worker, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
      toast.error(e.message);
    },
    // Nothing references the row — records keep the name as text — so an
    // undo is just adding them back.
    onSuccess: (_r, worker) =>
      toast.success(`${worker.full_name} removed from the workforce.`, {
        action: {
          label: "Undo",
          onClick: () => add.mutate(workerValues(worker)),
        },
      }),
    onSettled: () => refresh(),
  });

  // Filtered in the client: the register is already loaded and cached.
  const term = search.trim().toLowerCase();
  const visible = term
    ? workers.filter((w) =>
        [
          w.full_name,
          w.role,
          SHIFT_LABELS[w.shift] ?? w.shift,
          departmentName.get(w.department_id ?? "") ?? "",
        ].some((field) => field.toLowerCase().includes(term)),
      )
    : workers;

  return (
    <div className="space-y-5">
      <PanelHeader
        icon={HardHat}
        title="Workforce"
        description="The people who do the work. The shift log picks its operators from this list, and maintenance, issues and deviations pick who is assigned. Nobody here needs a login."
        count={workers.length}
        action={
          canManage ? (
            <WorkerBulkDialog
              factoryId={factoryId}
              departments={activeDepartments}
              existing={workers.map((w) => w.full_name)}
              onAdded={refresh}
            />
          ) : undefined
        }
      />

      {canManage && (
        <AddWorkerForm
          departmentOptions={departmentOptions}
          onAdd={(values) => add.mutateAsync(values)}
        />
      )}

      {workers.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, department, shift or role…"
            aria-label="Search the workforce"
            className={cn(FIELD, "pl-10")}
          />
        </div>
      )}

      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-deep">
          Could not load the workforce: {(error as Error).message}
        </p>
      ) : workers.length === 0 ? (
        <EmptyState
          icon={HardHat}
          title="No one on the workforce yet."
          hint={
            canManage
              ? "Add people above one at a time, or use Bulk add for a whole team."
              : "A manager adds people here."
          }
        />
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-ink-6 px-4 py-10 text-center text-sm text-ink-5">
          Nobody matches &ldquo;{search}&rdquo;.
        </p>
      ) : (
        <div className={cn(PANEL, "overflow-x-auto")}>
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-line bg-sunken-2 text-left text-[0.625rem] font-bold tracking-[0.07em] text-ink-3 uppercase">
                <th className="px-4 py-3">Full name</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Shift</th>
                <th className="px-4 py-3">Role</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((worker) =>
                editingId === worker.id ? (
                  <EditWorkerRow
                    key={worker.id}
                    worker={worker}
                    departmentOptions={departmentOptions}
                    pending={edit.isPending}
                    onSave={(values) => edit.mutate({ id: worker.id, values })}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <tr
                    key={worker.id}
                    className="border-b border-sunken last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-ink">
                      {worker.full_name}
                    </td>
                    <td className="px-4 py-3 text-ink-3">
                      {departmentName.get(worker.department_id ?? "") ?? (
                        <span className="text-ink-5">&mdash;</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block rounded-full bg-brand-soft px-2 py-0.5 text-[0.6875rem] font-medium text-brand-deep">
                        {SHIFT_LABELS[worker.shift] ?? worker.shift}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-3">{worker.role}</td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <IconButton
                            label={`Edit ${worker.full_name}`}
                            onClick={() => setEditingId(worker.id)}
                          >
                            <Pencil className="size-3.5" />
                          </IconButton>
                          <IconButton
                            label={`Delete ${worker.full_name}`}
                            onClick={() => remove.mutate(worker)}
                            danger
                          >
                            <Trash2 className="size-3.5" />
                          </IconButton>
                        </div>
                      </td>
                    )}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      {canManage && workers.length > 0 && (
        <p className="text-xs text-ink-5">
          Deleting someone takes them off every picker. Shift entries and other
          records that already name them keep the name.
        </p>
      )}
    </div>
  );
}

/**
 * Adds one person. Department, shift and role stay as they were after an
 * add, because people are usually entered a team at a time.
 */
function AddWorkerForm({
  departmentOptions,
  onAdd,
}: {
  departmentOptions: SelectOption[];
  onAdd: (values: WorkerValues) => Promise<unknown>;
}) {
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<WorkerValues>({
    resolver: zodResolver(workerSchema),
    defaultValues: EMPTY_WORKER,
  });

  async function onSubmit(values: WorkerValues) {
    try {
      await onAdd(values);
    } catch {
      return; // Already toasted by the mutation; keep what was typed.
    }
    reset({ ...values, fullName: "" });
  }

  const firstError =
    errors.fullName?.message ??
    errors.departmentId?.message ??
    errors.shift?.message ??
    errors.role?.message;

  return (
    <Composer title="Add a person">
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_8.5rem_minmax(0,1fr)_auto] lg:items-end">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="wf-name" className={LABEL}>
              Full name
            </label>
            <input
              id="wf-name"
              placeholder="e.g. Thian Mang"
              autoComplete="off"
              aria-invalid={Boolean(errors.fullName)}
              className={FIELD}
              {...register("fullName")}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="wf-department" className={LABEL}>
              Department
            </label>
            <Controller
              name="departmentId"
              control={control}
              render={({ field }) => (
                <SelectField
                  id="wf-department"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="No department"
                  clearable
                  options={departmentOptions}
                />
              )}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="wf-shift" className={LABEL}>
              Shift
            </label>
            <Controller
              name="shift"
              control={control}
              render={({ field }) => (
                <SelectField
                  id="wf-shift"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  options={SHIFT_OPTIONS}
                />
              )}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="wf-role" className={LABEL}>
              Role
            </label>
            <input
              id="wf-role"
              placeholder="e.g. Operator, Team leader"
              aria-invalid={Boolean(errors.role)}
              className={FIELD}
              {...register("role")}
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Add
          </button>
        </div>

        {firstError && (
          <p role="alert" className="mt-2.5 text-xs text-danger-deep">
            {firstError}
          </p>
        )}
        {departmentOptions.length === 0 && (
          <p className="mt-2.5 text-xs text-ink-5">
            No departments yet &mdash; add them in Configuration &rarr;
            Departments, or leave it blank for now.
          </p>
        )}
      </form>
    </Composer>
  );
}

/**
 * One row in edit mode. A table row can't hold a `<form>`, so Enter and the
 * tick submit through `handleSubmit` directly; Escape and the cross cancel.
 */
function EditWorkerRow({
  worker,
  departmentOptions,
  pending,
  onSave,
  onCancel,
}: {
  worker: Worker;
  departmentOptions: SelectOption[];
  pending: boolean;
  onSave: (values: WorkerValues) => void;
  onCancel: () => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<WorkerValues>({
    resolver: zodResolver(workerSchema),
    defaultValues: workerValues(worker),
  });

  const save = handleSubmit(onSave, (errs) =>
    toast.error(
      errs.fullName?.message ?? errs.role?.message ?? "Check the fields.",
    ),
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      void save();
    }
    if (e.key === "Escape") onCancel();
  }

  return (
    <tr className="border-b border-sunken bg-brand-tint last:border-0">
      <td className="px-4 py-2">
        <input
          autoFocus
          aria-label={`Full name for ${worker.full_name}`}
          aria-invalid={Boolean(errors.fullName)}
          onKeyDown={onKeyDown}
          className={CELL_INPUT}
          {...register("fullName")}
        />
      </td>
      <td className="px-4 py-2">
        <Controller
          name="departmentId"
          control={control}
          render={({ field }) => (
            <SelectField
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              ariaLabel={`Department for ${worker.full_name}`}
              placeholder="No department"
              clearable
              options={departmentOptions}
              className="h-8 rounded-lg px-2"
            />
          )}
        />
      </td>
      <td className="px-4 py-2">
        <Controller
          name="shift"
          control={control}
          render={({ field }) => (
            <SelectField
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              ariaLabel={`Shift for ${worker.full_name}`}
              options={SHIFT_OPTIONS}
              className="h-8 w-32 rounded-lg px-2"
            />
          )}
        />
      </td>
      <td className="px-4 py-2">
        <input
          aria-label={`Role for ${worker.full_name}`}
          aria-invalid={Boolean(errors.role)}
          onKeyDown={onKeyDown}
          className={CELL_INPUT}
          {...register("role")}
        />
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center justify-end gap-1.5">
          <IconButton label="Save" onClick={() => void save()}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4 text-teal" />
            )}
          </IconButton>
          <IconButton label="Cancel" onClick={onCancel}>
            <X className="size-4" />
          </IconButton>
        </div>
      </td>
    </tr>
  );
}

function IconButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "shrink-0 rounded-md p-1.5 text-ink-5 transition",
        danger
          ? "hover:bg-danger-soft hover:text-danger-deep"
          : "hover:bg-sunken-2 hover:text-ink-3",
      )}
    >
      {children}
    </button>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2 rounded-2xl border border-line-soft p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-sunken" />
      ))}
    </div>
  );
}
