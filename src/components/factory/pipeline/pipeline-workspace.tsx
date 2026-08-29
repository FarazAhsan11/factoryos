"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, LayoutGrid } from "lucide-react";
import { toast } from "sonner";

import { AdminTabs } from "@/components/factory/admin/admin-tabs";
import { BatchFamilies } from "@/components/factory/pipeline/batch-families";
import { JobDetailDialog } from "@/components/factory/pipeline/job-detail-dialog";
import { EditBatchDialog } from "@/components/factory/pipeline/edit-batch-dialog";
import { PlanStagesDialog } from "@/components/factory/pipeline/plan-stages-dialog";
import { NewBatchDialog } from "@/components/factory/pipeline/new-batch-dialog";
import { NewJobDialog } from "@/components/factory/pipeline/new-job-dialog";
import { PipelineBoard } from "@/components/factory/pipeline/pipeline-board";
import {
  batchStageKeys,
  fetchFactoryStages,
} from "@/lib/factory/batch-stage-queries";
import { PIPELINE_TABS } from "@/lib/factory/pipeline-tabs";
import {
  deletePipelineJob,
  fetchPipelineJobs,
  pipelineKeys,
  promoteScheduledJobs,
  type PipelineJob,
} from "@/lib/factory/pipeline-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";

/**
 * Pipeline → Kanban. The board of batches currently being worked.
 *
 * Everything on screen is derived: a job's column comes from what the shift
 * log holds for its batch, and its progress from the stage tagged as final in
 * Admin → Processes. The only writes here are adding a job and removing one
 * that has not started — the trigger owns the rest.
 */
export function PipelineWorkspace({
  factoryId,
  userId,
  units,
  canManage,
}: {
  factoryId: string;
  userId: string;
  units: { singular: string; plural: string };
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [detailJob, setDetailJob] = useState<PipelineJob | null>(null);
  const [tab, setTab] = useState("board");
  /**
   * The families view opens New batch itself, pre-set to Packing with the
   * parent filled — the prototype's `quickAddPackingFor`. Held here rather
   * than inside the families view so there is one dialog on the page, not one
   * per family card.
   */
  const [packingParent, setPackingParent] = useState<string | null>(null);
  const [newBatchOpen, setNewBatchOpen] = useState(false);
  const [planJob, setPlanJob] = useState<PipelineJob | null>(null);
  const [editJob, setEditJob] = useState<PipelineJob | null>(null);

  const {
    data: jobs = [],
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: pipelineKeys.all(factoryId),
    // Scheduled batches are promoted immediately before the board is read, so
    // a batch dated for today is already in Planned by the time it renders.
    // The promotion is idempotent, which is what makes running it on every
    // load — rather than on a timer nobody can see — the simple option.
    queryFn: async () => {
      // Deliberately swallowed: a promotion that fails must not blank the
      // board. The jobs that already exist are the more important half, and a
      // date that missed its window is picked up by the next load anyway.
      const promoted = await promoteScheduledJobs(factoryId).catch(() => 0);
      if (promoted > 0) {
        toast.success(
          `${promoted} scheduled batch${promoted === 1 ? "" : "es"} added to Planned.`,
        );
      }
      return fetchPipelineJobs(factoryId);
    },
  });

  // Same cache keys as Admin and the log form, so arriving from either has
  // these already populated.
  const { data: products = [] } = useQuery({
    queryKey: productKeys.all(factoryId),
    queryFn: () => fetchProducts(factoryId),
  });
  // Every plan in the tenant, in one read. A card needs its own stages to draw
  // the strip, and forty cards each fetching their own would be forty requests
  // for what is one small table.
  const { data: stages = [] } = useQuery({
    queryKey: batchStageKeys.all(factoryId),
    queryFn: () => fetchFactoryStages(factoryId),
  });

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: pipelineKeys.all(factoryId) }),
      queryClient.invalidateQueries({ queryKey: batchStageKeys.all(factoryId) }),
    ]);
  }, [queryClient, factoryId]);

  /** Active batches with no job yet — exactly what the New Job modal offers. */
  const available = useMemo(() => {
    const taken = new Set(jobs.map((j) => j.product_id));
    return products.filter((p) => p.active && !taken.has(p.id));
  }, [products, jobs]);

  // Batches that cannot be logged against yet: planned, but never issued for
  // production. Said out loud rather than left as an operator being refused at
  // 6am for a planning step nobody told them about.
  const unissued = useMemo(
    () => jobs.filter((j) => j.status === "planned" && !j.issued_at),
    [jobs],
  );

  const remove = useMutation({
    mutationFn: (job: PipelineJob) => deletePipelineJob(job.id),
    onSuccess: async (_data, job) => {
      await refresh();
      toast.success(`Batch ${job.batch_no} removed from the board.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col lg:min-h-0 lg:flex-1">
      <div className="mb-5 flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold tracking-[0.09em] text-ink-5 uppercase">
            Production pipeline
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            Batch tracker
          </h1>
          <p className="mt-1 text-sm text-ink-4">
            Cards move themselves: first entry → In production · issue flagged →
            On hold · final stage complete → Finished.
          </p>
        </div>

        {canManage && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {/* Secondary, and kept: picking twenty already-catalogued batches
                off a list is still the fastest way to fill the board, and the
                typed form is the wrong shape for it. */}
            <NewJobDialog
              factoryId={factoryId}
              userId={userId}
              available={available}
              onCreated={refresh}
            />
            <NewBatchDialog
              factoryId={factoryId}
              userId={userId}
              products={products}
              jobs={jobs}
              open={newBatchOpen}
              onOpenChange={(open) => {
                setNewBatchOpen(open);
                // The preset only belongs to the run that opened it — leaving
                // it set would make the next New batch open on Packing under
                // a parent nobody chose.
                if (!open) setPackingParent(null);
              }}
              presetParentId={packingParent}
              onCreated={refresh}
            />
          </div>
        )}
      </div>

      <AdminTabs
        tabs={PIPELINE_TABS}
        active={tab}
        label="Pipeline views"
        onSelect={setTab}
      />

      {!isPending && unissued.length > 0 && (
        <div className="mb-4 flex shrink-0 items-start gap-2.5 rounded-xl border border-warn-line bg-warn-tint px-4 py-3 text-sm text-warn-ink shadow-[inset_0_1px_2px_rgb(180_83_9/0.06)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong className="font-semibold">
              {unissued.length} batch{unissued.length === 1 ? "" : "es"} not
              issued yet.
            </strong>{" "}
            Nothing can be logged against{" "}
            {unissued.length === 1 ? "it" : "them"} until{" "}
            {unissued.length === 1 ? "its" : "their"} stages are planned and{" "}
            {unissued.length === 1 ? "it is" : "they are"} issued for
            production — open a card to do it. Downtime is always loggable.
          </p>
        </div>
      )}

      {isPending ? (
        <BoardSkeleton />
      ) : isError ? (
        <p className="rounded-2xl border border-danger-line bg-danger-soft px-4 py-6 text-center text-sm font-medium text-danger-deep">
          Could not load the pipeline: {(error as Error).message}
        </p>
      ) : jobs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-16 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-sunken text-ink-6">
            <LayoutGrid className="size-6" />
          </span>
          <p className="mt-3 text-sm font-medium text-ink-3">
            Nothing on the board yet.
          </p>
          <p className="mt-1 text-xs text-ink-5">
            {canManage
              ? "Use New batch to raise one, or From catalogue to pick several."
              : "A manager adds batches from the product catalogue."}
          </p>
        </div>
      ) : tab === "families" ? (
        <BatchFamilies
          jobs={jobs}
          canManage={canManage}
          onOpen={setDetailJob}
          onAddPacking={(parentId) => {
            setPackingParent(parentId);
            setNewBatchOpen(true);
          }}
        />
      ) : (
        <PipelineBoard
          jobs={jobs}
          stages={stages}
          unitWord={units.singular}
          canManage={canManage}
          onOpen={setDetailJob}
          onPlan={setPlanJob}
          onDelete={(job) => remove.mutate(job)}
        />
      )}

      <JobDetailDialog
        job={detailJob}
        unitWord={units.singular}
        canManage={canManage}
        onPlan={(job) => {
          // One dialog at a time: stacking the planner on top of the details
          // leaves two backdrops and an Escape key that closes the wrong one.
          setDetailJob(null);
          setPlanJob(job);
        }}
        onEdit={(job) => {
          setDetailJob(null);
          setEditJob(job);
        }}
        onClose={() => setDetailJob(null)}
      />

      <EditBatchDialog
        job={editJob}
        jobs={jobs}
        onSaved={async () => {
          setEditJob(null);
          await refresh();
        }}
        onClose={() => setEditJob(null)}
      />

      <PlanStagesDialog
        job={planJob}
        factoryId={factoryId}
        canManage={canManage}
        onClose={() => setPlanJob(null)}
      />
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-4 lg:grid-rows-1">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col overflow-hidden rounded-2xl border border-line bg-sunken lg:min-h-0"
        >
          <div className="h-[41px] shrink-0 animate-pulse border-b border-line bg-sunken-2" />
          <div className="space-y-2.5 p-2.5">
            <div className="h-28 animate-pulse rounded-xl bg-surface" />
            <div className="h-28 animate-pulse rounded-xl bg-surface" />
          </div>
        </div>
      ))}
    </div>
  );
}
