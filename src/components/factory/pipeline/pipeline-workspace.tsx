"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { JobDetailDialog } from "@/components/factory/pipeline/job-detail-dialog";
import { NewJobDialog } from "@/components/factory/pipeline/new-job-dialog";
import { PipelineBoard } from "@/components/factory/pipeline/pipeline-board";
import {
  deletePipelineJob,
  fetchPipelineJobs,
  pipelineKeys,
  promoteScheduledJobs,
  type PipelineJob,
} from "@/lib/factory/pipeline-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";

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
  const { data: processList = [] } = useQuery({
    queryKey: setupKeys.all("factory_processes", factoryId),
    queryFn: () => fetchSetupItems("factory_processes", factoryId),
  });

  const refresh = useCallback(
    () =>
      queryClient.invalidateQueries({ queryKey: pipelineKeys.all(factoryId) }),
    [queryClient, factoryId],
  );

  /** Active batches with no job yet — exactly what the New Job modal offers. */
  const available = useMemo(() => {
    const taken = new Set(jobs.map((j) => j.product_id));
    return products.filter((p) => p.active && !taken.has(p.id));
  }, [products, jobs]);

  // Without a final stage there is no measure of "done", so nothing ever
  // leaves In Production. Said out loud rather than left as a board that
  // quietly stops working — the fix is one click in Admin.
  const hasFinalStage = useMemo(
    () => processList.some((p) => p.flags.final),
    [processList],
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
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-5">
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
          <NewJobDialog
            factoryId={factoryId}
            userId={userId}
            available={available}
            onCreated={refresh}
          />
        )}
      </div>

      {!isPending && !hasFinalStage && jobs.length > 0 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-warn-line bg-warn-tint px-4 py-3 text-sm text-warn-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong className="font-semibold">No final stage set.</strong> Jobs
            can&rsquo;t complete until one process is tagged{" "}
            <strong className="font-semibold">Final</strong> in Admin &amp;
            Settings → Processes — normally the last packing or labelling step.
          </p>
        </div>
      )}

      {isPending ? (
        <BoardSkeleton />
      ) : isError ? (
        <p className="rounded-2xl border border-danger-line bg-danger-soft px-4 py-6 text-center text-sm text-danger-deep">
          Could not load the pipeline: {(error as Error).message}
        </p>
      ) : jobs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-6 bg-surface px-4 py-16 text-center">
          <p className="text-sm text-ink-4">Nothing on the board yet.</p>
          <p className="mt-1 text-xs text-ink-5">
            {canManage
              ? "Use New job to start tracking batches from the catalogue."
              : "A manager adds batches from the product catalogue."}
          </p>
        </div>
      ) : (
        <PipelineBoard
          jobs={jobs}
          unitWord={units.singular}
          canManage={canManage}
          onOpen={setDetailJob}
          onDelete={(job) => remove.mutate(job)}
        />
      )}

      <JobDetailDialog
        job={detailJob}
        unitWord={units.singular}
        onClose={() => setDetailJob(null)}
      />
    </>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="space-y-2.5 rounded-2xl border border-line-soft bg-surface p-3"
        >
          <div className="h-8 animate-pulse rounded-lg bg-sunken" />
          <div className="h-24 animate-pulse rounded-xl bg-sunken" />
          <div className="h-24 animate-pulse rounded-xl bg-sunken" />
        </div>
      ))}
    </div>
  );
}
