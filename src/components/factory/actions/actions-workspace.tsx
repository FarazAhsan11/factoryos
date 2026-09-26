"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ActionDetailDialog } from "@/components/factory/actions/action-detail-dialog";
import { ActionsTable } from "@/components/factory/actions/actions-table";
import { ActionStageTabs } from "@/components/factory/actions/action-stage-tabs";
import { NewActionDialog } from "@/components/factory/actions/new-action-dialog";
import {
  RegisterSearch,
  RegisterSkeleton,
} from "@/components/factory/register-table";
import type { FactoryRole } from "@/lib/factory/context";
import {
  STAGE_LABELS,
  actionKeys,
  fetchActions,
  needsAttention,
  stageCounts,
  type ActionStage,
  type FactoryAction,
} from "@/lib/factory/action-queries";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";

/** What the keyword box searches — the columns somebody actually types into. */
function haystack(a: FactoryAction): string {
  return [
    a.title,
    a.unit_name,
    a.category,
    a.batch_no,
    a.product_name,
    a.product_code,
    a.assigned_to,
    a.root_cause,
    a.corrective_action,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Issues & CAPAs — the accountability loop.
 *
 * A register in the Deviations & NCRs frame: stage chips, a keyword box, and
 * a table with every stage's evidence as a column.
 *
 * Five stages, one chip each: Open → Investigating → Action taken →
 * Verification → Closed. An
 * issue moves one stage at a time and pays for each move with the thing that
 * stage produces, which is what stops "resolved" from being a claim anyone can
 * make in a single click.
 *
 * Both clocks are computed in the database on every read, so this screen never
 * has to run a timer or patch a status to keep them honest.
 */
export function ActionsWorkspace({
  factoryId,
  userId,
  role,
  units,
}: {
  factoryId: string;
  userId: string;
  role: FactoryRole;
  units: { singular: string; plural: string };
}) {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<ActionStage>("open");
  const [attention, setAttention] = useState(false);
  const [selected, setSelected] = useState<FactoryAction | null>(null);
  const [search, setSearch] = useState("");
  const term = useDeferredValue(search).trim().toLowerCase();

  const {
    data: actions = [],
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: actionKeys.all(factoryId),
    queryFn: () => fetchActions(factoryId),
    // The clock keeps moving even when nothing is written: an issue can go
    // overdue, then escalate, while this page sits open. A minute is often
    // enough to catch that without anyone reloading.
    refetchInterval: 60_000,
  });

  const { data: unitList = [] } = useQuery({
    queryKey: setupKeys.all("factory_units", factoryId),
    queryFn: () => fetchSetupItems("factory_units", factoryId),
  });

  const refresh = useCallback(
    () =>
      queryClient.invalidateQueries({ queryKey: actionKeys.all(factoryId) }),
    [queryClient, factoryId],
  );

  // The counts follow the keyword box, so "Open 3" always describes the list
  // its chip would show.
  const searched = useMemo(
    () => (term ? actions.filter((a) => haystack(a).includes(term)) : actions),
    [actions, term],
  );

  const counts = useMemo(() => stageCounts(searched), [searched]);

  const attentionCount = useMemo(
    () => searched.filter(needsAttention).length,
    [searched],
  );

  const visible = useMemo(
    () =>
      searched.filter(
        (a) => a.status === stage && (!attention || needsAttention(a)),
      ),
    [searched, stage, attention],
  );

  // The dialog holds a snapshot, so it has to be re-read from the refetched
  // list — otherwise advancing an issue leaves its own dialog a stage behind.
  const selectedLive = useMemo(
    () => actions.find((a) => a.id === selected?.id) ?? selected,
    [actions, selected],
  );

  return (
    <div className="flex flex-col lg:min-h-0 lg:flex-1">
      <div className="mb-5 flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-5">
            Accountability loop
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            Issues &amp; CAPAs
          </h1>
          <p className="mt-1 text-sm text-ink-4">
            Issues flagged in the shift log land here automatically, then work
            through investigation, a recorded fix, and sign-off.
          </p>
        </div>

        <NewActionDialog
          factoryId={factoryId}
          userId={userId}
          units={unitList}
          unitWord={units.singular}
          onCreated={refresh}
        />
      </div>

      <ActionStageTabs
        stage={stage}
        onStage={setStage}
        counts={counts}
        attention={attention}
        attentionCount={attentionCount}
        onAttention={setAttention}
      >
        <RegisterSearch
          value={search}
          onChange={setSearch}
          placeholder="Filter by title, batch, product, owner, root cause…"
          label="Filter issues"
        />
      </ActionStageTabs>

      <div className="min-h-0 flex-1 lg:overflow-hidden">
        {isPending ? (
          <RegisterSkeleton />
        ) : isError ? (
          <p className="rounded-2xl border border-danger-line bg-danger-soft px-4 py-6 text-center text-sm font-medium text-danger-deep">
            Could not load issues: {(error as Error).message}
          </p>
        ) : (
          <ActionsTable
            actions={visible}
            unitWord={units.singular}
            onOpen={setSelected}
            {...emptyCopy({
              stage,
              attention,
              term,
              total: actions.length,
              inStage: counts[stage],
            })}
          />
        )}
      </div>

      <ActionDetailDialog
        action={selectedLive}
        factoryId={factoryId}
        userId={userId}
        role={role}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

/**
 * An empty stage is usually good news, and saying which kind of empty saves
 * someone wondering whether the filter is broken.
 */
function emptyCopy({
  stage,
  attention,
  term,
  total,
  inStage,
}: {
  stage: ActionStage;
  attention: boolean;
  term: string;
  total: number;
  inStage: number;
}): { emptyTitle: string; emptyBody: string } {
  const [emptyTitle, emptyBody] =
    total === 0
      ? ["No issues yet.", "Flag one in the shift log and it appears here."]
      : term
        ? [
            `Nothing in ${STAGE_LABELS[stage]} matches that.`,
            "Try a different keyword, or clear the filter.",
          ]
        : attention && inStage > 0
          ? [
              `Nothing late in ${STAGE_LABELS[stage]}.`,
              "Turn off “Needs attention” to see the rest.",
            ]
          : [
              `Nothing in ${STAGE_LABELS[stage]}.`,
              stage === "closed"
                ? "Issues appear here once a supervisor signs them off."
                : "Try another stage.",
            ];
  return { emptyTitle, emptyBody };
}
