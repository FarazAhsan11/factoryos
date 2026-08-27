"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ActionDetailDialog } from "@/components/factory/actions/action-detail-dialog";
import { ActionList } from "@/components/factory/actions/action-list";
import { ActionStageTabs } from "@/components/factory/actions/action-stage-tabs";
import { NewActionDialog } from "@/components/factory/actions/new-action-dialog";
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

/**
 * Issues & CAPAs — the accountability loop.
 *
 * Four stages, one tab each: Open → Investigating → Action taken → Closed. An
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

  const counts = useMemo(() => stageCounts(actions), [actions]);

  const attentionCount = useMemo(
    () => actions.filter(needsAttention).length,
    [actions],
  );

  const visible = useMemo(
    () =>
      actions.filter(
        (a) => a.status === stage && (!attention || needsAttention(a)),
      ),
    [actions, stage, attention],
  );

  // The dialog holds a snapshot, so it has to be re-read from the refetched
  // list — otherwise advancing an issue leaves its own dialog a stage behind.
  const selectedLive = useMemo(
    () => actions.find((a) => a.id === selected?.id) ?? selected,
    [actions, selected],
  );

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-5">
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
      />

      {isPending ? (
        <ListSkeleton />
      ) : isError ? (
        <p className="rounded-2xl border border-danger-line bg-danger-soft px-4 py-6 text-center text-sm text-danger-deep">
          Could not load issues: {(error as Error).message}
        </p>
      ) : visible.length === 0 ? (
        <EmptyState
          stage={stage}
          attention={attention}
          total={actions.length}
          inStage={counts[stage]}
        />
      ) : (
        <ActionList actions={visible} onOpen={setSelected} />
      )}

      <ActionDetailDialog
        action={selectedLive}
        factoryId={factoryId}
        userId={userId}
        role={role}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

/**
 * An empty stage is usually good news, and saying which kind of empty saves
 * someone wondering whether the filter is broken.
 */
function EmptyState({
  stage,
  attention,
  total,
  inStage,
}: {
  stage: ActionStage;
  attention: boolean;
  total: number;
  inStage: number;
}) {
  const [title, hint] =
    total === 0
      ? ["No issues yet.", "Flag one in the shift log and it appears here."]
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

  return (
    <div className="rounded-2xl border border-dashed border-ink-6 bg-surface px-4 py-16 text-center">
      <p className="text-sm text-ink-4">{title}</p>
      <p className="mt-1 text-xs text-ink-5">{hint}</p>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-[104px] animate-pulse rounded-2xl border border-line-soft bg-surface"
        />
      ))}
    </div>
  );
}
