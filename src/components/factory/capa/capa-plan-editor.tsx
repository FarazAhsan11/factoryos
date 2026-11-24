"use client";

import { Plus, X } from "lucide-react";

import {
  ACTION_BUTTON_SM,
  CONTROL,
  formatDate,
} from "@/components/factory/deviations/deviation-fields";
import { DateField } from "@/components/ui/date-picker";
import { addDays } from "@/lib/factory/dates";
import {
  blankAction,
  type CapaActionKind,
  type DraftAction,
  type PlanDraft,
} from "@/lib/factory/capa-queries";
import { cn } from "@/lib/utils";

const KIND_HEAD: Record<CapaActionKind, { title: string; sub: string; word: string; ph: string }> = {
  ca: {
    title: "Corrective actions",
    sub: "Remove the cause of this problem.",
    word: "corrective",
    ph: "e.g. Replace worn closing pins on encapsulator 2",
  },
  pa: {
    title: "Preventive actions",
    sub: "Optional — stop it happening on other products, lines or suppliers.",
    word: "preventive",
    ph: "e.g. Add a pin-wear check to the PM plan for all encapsulators",
  },
};

/**
 * The CAPA plan as qms-v8 writes it: corrective and preventive actions in two
 * tables (action, owner, target date), then the effectiveness check — the
 * criteria, when it is due (when the actions are done, +1 / +3 / +6 months
 * from the last target date, or any date) and who verifies.
 *
 * Controlled: the caller holds the draft and decides when it is saved — on a
 * case it becomes a new CAPA, on the CAPA page it is the plan being written.
 */
export function CapaPlanEditor({
  value: d,
  onChange,
  today,
}: {
  value: PlanDraft;
  onChange: (next: PlanDraft) => void;
  today: string;
}) {
  const setAction = (key: string, patch: Partial<DraftAction>) =>
    onChange({
      ...d,
      actions: d.actions.map((a) => (a.key === key ? { ...a, ...patch } : a)),
    });

  const last = d.actions.map((a) => a.due).filter(Boolean).sort().at(-1) ?? today;
  const quick = [1, 3, 6].map((m) => ({ value: addDays(last, m * 30), label: `+${m} month${m > 1 ? "s" : ""}` }));

  return (
    <div className="space-y-6">
      {(["ca", "pa"] as const).map((kind) => {
        const rows = d.actions.filter((a) => a.kind === kind);
        const head = KIND_HEAD[kind];
        return (
          <section key={kind} className="space-y-2.5">
            <PlanGroupHead title={head.title} sub={head.sub} />
            {rows.length > 0 && (
              <div className="scrollbar-slim overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="bg-sunken text-left text-xs text-ink-4">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Action</th>
                      <th className="w-[13rem] px-3 py-2 font-semibold">Owner</th>
                      <th className="w-[11rem] px-3 py-2 font-semibold">Target date</th>
                      <th className="w-10 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft bg-surface">
                    {rows.map((a) => (
                      <tr key={a.key} className="align-top">
                        <td className="px-2 py-1.5">
                          <input
                            value={a.text}
                            onChange={(e) => setAction(a.key, { text: e.target.value })}
                            placeholder={head.ph}
                            aria-label="Action"
                            className={cn(CONTROL, "h-9")}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={a.owner}
                            onChange={(e) => setAction(a.key, { owner: e.target.value })}
                            placeholder="Owner"
                            aria-label="Owner"
                            className={cn(CONTROL, "h-9")}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <DateField
                            value={a.due}
                            onChange={(v) => setAction(a.key, { due: v })}
                            min={today}
                            ariaLabel="Target date"
                            compact
                          />
                        </td>
                        <td className="px-1 py-1.5 text-center">
                          <button
                            type="button"
                            title="Remove"
                            aria-label="Remove action"
                            onClick={() =>
                              onChange({ ...d, actions: d.actions.filter((x) => x.key !== a.key) })
                            }
                            className="mt-1 grid size-8 place-items-center rounded-lg text-ink-4 transition hover:bg-sunken-2 hover:text-danger"
                          >
                            <X className="size-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button
              type="button"
              onClick={() => onChange({ ...d, actions: [...d.actions, blankAction(kind)] })}
              className={ACTION_BUTTON_SM}
            >
              <Plus className="size-3.5" />
              Add {head.word} action
            </button>
          </section>
        );
      })}

      <section className="space-y-3">
        <PlanGroupHead
          title="Effectiveness check"
          sub="Agreed now, checked once the actions have had time to work."
        />
        <div className="space-y-1.5">
          <label htmlFor="pe-criteria" className="block text-xs font-medium text-ink-3">
            Effectiveness criteria
          </label>
          <input
            id="pe-criteria"
            value={d.criteria}
            onChange={(e) => onChange({ ...d, criteria: e.target.value })}
            placeholder="A measurable result, e.g. no capsule denting in the next 10 batches of PC2173"
            className={CONTROL}
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-ink-3">Check due</p>
          <div className="flex flex-wrap items-center gap-2">
            <Chip
              on={d.checkMode === "at_implementation"}
              onClick={() => onChange({ ...d, checkMode: "at_implementation", verifyBy: "" })}
            >
              When the actions are done
            </Chip>
            {quick.map((q) => (
              <Chip
                key={q.label}
                on={d.checkMode === "dated" && d.verifyBy === q.value}
                onClick={() => onChange({ ...d, checkMode: "dated", verifyBy: q.value })}
                title={formatDate(q.value)}
              >
                {q.label}
              </Chip>
            ))}
            <div className="w-[11rem]">
              <DateField
                value={d.checkMode === "dated" ? d.verifyBy : ""}
                onChange={(v) =>
                  onChange(v ? { ...d, checkMode: "dated", verifyBy: v } : { ...d, verifyBy: "" })
                }
                min={today}
                ariaLabel="Check due date"
                compact
              />
            </div>
          </div>
          <p className="text-[0.6875rem] leading-snug text-ink-5">
            {d.checkMode === "at_implementation"
              ? "For a simple fix with nothing to trend: verified as soon as every action is done."
              : "Months count from the last target date. Or pick any date."}
          </p>
        </div>

        <div className="max-w-sm space-y-1.5">
          <label className="block text-xs font-medium text-ink-3">Verifier</label>
          <input
            value={d.checker}
            onChange={(e) => onChange({ ...d, checker: e.target.value })}
            placeholder="Who verifies it"
            aria-label="Verifier"
            className={CONTROL}
          />
          <p className="text-[0.6875rem] leading-snug text-ink-5">Usually QA.</p>
        </div>
      </section>
    </div>
  );
}

export function PlanGroupHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-sm font-semibold text-ink">{title}</span>
      {sub && <span className="text-xs text-ink-4">{sub}</span>}
    </p>
  );
}

function Chip({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={cn(
        "h-8 rounded-full border px-3 text-xs font-semibold transition",
        on
          ? "border-brand bg-brand-soft text-brand-deep"
          : "border-line bg-surface text-ink-3 hover:border-line-strong",
      )}
    >
      {children}
    </button>
  );
}
