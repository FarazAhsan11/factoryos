"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";

import { caseHref } from "@/components/factory/capa/capa-page";
import { CapaStepDots } from "@/components/factory/capa/capa-stepper";
import { formatDate } from "@/components/factory/deviations/deviation-fields";
import {
  CELL,
  RegisterEmpty,
  RegisterFoot,
  RegisterRow,
  RegisterSearch,
  RegisterSkeleton,
  RegisterTable,
  RegisterViews,
  TH,
} from "@/components/factory/register-table";
import {
  capaKeys,
  capaNext,
  fetchCapas,
  type Capa,
} from "@/lib/factory/capa-queries";
import { todayKey } from "@/lib/factory/dates";
import { typeMeta } from "@/lib/factory/deviation-queries";
import { useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

type View = "open" | "plan" | "do" | "check" | "closed" | "withdrawn" | "all";

const VIEWS: { key: View; label: string; hint: string; test: (c: Capa) => boolean }[] = [
  { key: "open", label: "All open", hint: "Every CAPA not yet closed", test: (c) => c.step !== "closed" && c.step !== "withdrawn" },
  { key: "plan", label: "Awaiting approval", hint: "Plan being written or waiting for approval", test: (c) => c.step === "plan" },
  { key: "do", label: "Implementing", hint: "Plan approved, actions being done", test: (c) => c.step === "do" },
  { key: "check", label: "Verification due", hint: "Every action done — the effectiveness check is next", test: (c) => c.step === "check" },
  { key: "closed", label: "Closed", hint: "Verified effective", test: (c) => c.step === "closed" },
  { key: "withdrawn", label: "Withdrawn", hint: "Withdrawn before the plan was approved", test: (c) => c.step === "withdrawn" },
  { key: "all", label: "All", hint: "Every CAPA ever raised", test: () => true },
];

function haystack(c: Capa): string {
  return [c.capa_no, c.title, ...c.action_owners, ...c.cases.map((k) => k.deviation_no)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * The CAPA register (qms-v8) — every CAPA by where it stands: awaiting
 * approval, implementing, verification due, closed. Columns: CAPA, title
 * (with Follow-up / Recurred), status, what is due next, the action owners
 * and the cases. A row opens the CAPA page. A CAPA is raised from a case's
 * Actions tab, never here: a plan with no problem behind it is not a CAPA.
 */
export function CapaRegister({
  factoryId,
  slug,
  onOpenCase,
}: {
  factoryId: string;
  slug: string;
  onOpenCase: (caseId: string) => void;
}) {
  const router = useRouter();
  const today = useRenderClock(todayKey);
  const [view, setView] = useState<View>("open");
  const [search, setSearch] = useState("");
  const term = useDeferredValue(search).trim().toLowerCase();

  const { data: capas = [], isPending, isError, error } = useQuery({
    queryKey: capaKeys.all(factoryId),
    queryFn: () => fetchCapas(factoryId),
  });

  const narrowed = useMemo(
    () => capas.filter((c) => !term || haystack(c).includes(term)),
    [capas, term],
  );
  const visible = useMemo(() => {
    const test = VIEWS.find((v) => v.key === view)!.test;
    // Soonest "next" date first; nothing dated last.
    return narrowed
      .filter(test)
      .sort((a, b) => (capaNext(a).date ?? "9999").localeCompare(capaNext(b).date ?? "9999"));
  }, [narrowed, view]);

  const checked = capas.filter((c) => c.check_count > 0);
  const firstTime = checked.length
    ? Math.round((checked.filter((c) => c.first_check_effective).length / checked.length) * 100)
    : null;

  return (
    <>
      <div className="mb-4 shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">CAPA register</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-4">
          Each CAPA moves Plan → Implement → Verify → Closed. Raise one from a case&apos;s
          Actions tab.
          {firstTime !== null && ` ${firstTime}% were effective at the first check.`}
        </p>
      </div>

      <div className="mb-4 shrink-0">
        <RegisterViews
          views={VIEWS.map((v) => ({
            key: v.key,
            label: v.label,
            hint: v.hint,
            count: narrowed.filter(v.test).length,
          }))}
          value={view}
          onChange={setView}
          label="CAPA views"
        />
      </div>

      <div className="mb-3 flex shrink-0 justify-end">
        <div className="w-full sm:w-80">
          <RegisterSearch
            value={search}
            onChange={setSearch}
            placeholder="Search CAPA no., title, action owner, case no.…"
            label="Search CAPAs"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 lg:overflow-hidden">
        {isPending ? (
          <RegisterSkeleton />
        ) : isError ? (
          <p className="rounded-2xl border border-danger-line bg-danger-soft px-4 py-6 text-center text-sm font-medium text-danger-deep">
            Could not load the register: {(error as Error).message}
          </p>
        ) : visible.length === 0 ? (
          <RegisterEmpty
            icon={ClipboardCheck}
            title={capas.length === 0 ? "No CAPAs yet." : "No CAPAs in this view."}
            body={
              capas.length === 0
                ? "Create one from a case's Actions tab when the case needs one."
                : term
                  ? "Try a different keyword, or clear the search."
                  : "Try another view."
            }
          />
        ) : (
          <RegisterTable
            plain
            head={
              <>
                <th className={TH}>CAPA</th>
                <th className={TH}>Title</th>
                <th className={TH}>Status</th>
                <th className={TH}>Next</th>
                <th className={TH}>Action owners</th>
                <th className={TH}>Cases</th>
              </>
            }
          >
            {visible.map((c) => {
              const next = capaNext(c);
              const overdue = c.step !== "closed" && c.step !== "withdrawn" && next.date !== null && next.date < today;
              return (
                <RegisterRow
                  key={c.id}
                  onOpen={() => router.push(`/factory/${slug}/deviations/capa/${c.id}`)}
                >
                  <td className={cn(CELL, "font-mono text-[0.78rem] font-medium text-brand")}>
                    {c.capa_no}
                  </td>
                  <td className="max-w-[26rem] min-w-[14rem] px-3 py-3 align-middle text-[0.8125rem] font-medium text-ink">
                    {c.title}
                    {c.recurrence_of && (
                      <span className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-[0.6875rem] font-semibold whitespace-nowrap text-warn-deep">
                        Follow-up
                      </span>
                    )}
                    {c.recurred_by.length > 0 && (
                      <span className="ml-2 rounded-full bg-danger-soft px-2 py-0.5 text-[0.6875rem] font-semibold whitespace-nowrap text-danger-deep">
                        Recurred
                      </span>
                    )}
                  </td>
                  <td className={CELL}>
                    <CapaStepDots capa={c} />
                  </td>
                  <td className={cn(CELL, overdue && "font-semibold text-danger-deep")} title={next.text}>
                    {next.date ? formatDate(next.date) : <span className="text-ink-6">—</span>}
                  </td>
                  <td className="max-w-[16rem] px-3 py-3 align-middle text-[0.8125rem] text-ink-2">
                    {c.action_owners.length > 0 ? (
                      c.action_owners.join(", ")
                    ) : (
                      <span className="text-ink-6">—</span>
                    )}
                  </td>
                  <td className={CELL}>
                    {c.cases.length === 0 ? (
                      <span className="text-ink-6">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {c.cases.map((k) => (
                          <button
                            key={k.id}
                            type="button"
                            // The row opens the CAPA; a case number opens the case.
                            onClick={(e) => {
                              e.stopPropagation();
                              // A deviation opens on its page; an NCR or a
                              // complaint in its dialog, on this screen.
                              if (k.type !== "complaint") {
                                router.push(caseHref(slug, k));
                              } else {
                                onOpenCase(k.id);
                              }
                            }}
                            onKeyDown={(e) => e.stopPropagation()}
                            className={cn(
                              "rounded-md px-1.5 py-0.5 font-mono text-[0.6875rem] font-semibold ring-1 ring-current/15 transition hover:brightness-95",
                              typeMeta(k.type).pill,
                            )}
                          >
                            {k.deviation_no}
                          </button>
                        ))}
                      </span>
                    )}
                  </td>
                </RegisterRow>
              );
            })}
          </RegisterTable>
        )}
      </div>
      {!isPending && !isError && <RegisterFoot count={visible.length} />}
    </>
  );
}
