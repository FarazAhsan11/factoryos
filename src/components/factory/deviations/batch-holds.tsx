"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  AREA,
  CONTROL,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from "@/components/factory/deviations/deviation-fields";
import { formatDateTime, formatDay } from "@/lib/factory/dates";
import { deviationKeys, type Deviation } from "@/lib/factory/deviation-queries";
import {
  HOLD_STATUS_LABEL,
  decideHold,
  fetchHolds,
  holdKeys,
  placeHolds,
  type BatchHold,
} from "@/lib/factory/hold-queries";
import { pipelineKeys } from "@/lib/factory/pipeline-queries";
import { cn } from "@/lib/utils";

const STATUS_TEXT: Record<BatchHold["status"], string> = {
  on_hold: "font-semibold text-danger-deep",
  released: "text-teal-deep",
  rejected: "text-ink-3",
};

/** "46520, 46545 46580" → ["46520", "46545", "46580"]. */
export function splitBatches(text: string): string[] {
  return text
    .split(/[,;\s]+/)
    .map((b) => b.trim())
    .filter(Boolean);
}

/**
 * A deviation's batch holds (0069), as the reference QMS keeps them: each
 * held batch on its own row, and QA deciding each one — **release** it, with
 * why it is safe while the case stays open, or **reject** it — once the
 * impact is assessed. More batches can be put on hold while the case is open.
 * The case cannot close while one is still on hold.
 */
export function BatchHolds({
  deviation: d,
  factoryId,
  canDecide,
  viewerName,
}: {
  deviation: Deviation;
  factoryId: string;
  /** Supervisor and up, on an open case. */
  canDecide: boolean;
  viewerName: string;
}) {
  const queryClient = useQueryClient();
  const { data: holds = [], isPending } = useQuery({
    queryKey: holdKeys.forCase(factoryId, d.id),
    queryFn: () => fetchHolds(d.id),
  });
  const [deciding, setDeciding] = useState<{
    id: string;
    decision: "released" | "rejected";
  } | null>(null);
  const [adding, setAdding] = useState(false);

  // Holds move the board's cards and the case header with them.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) }),
      queryClient.invalidateQueries({ queryKey: pipelineKeys.all(factoryId) }),
    ]);

  const needsImpact =
    d.investigation_required !== false && !(d.impact ?? "").trim();

  function startDecision(h: BatchHold, decision: "released" | "rejected") {
    if (decision === "released" && needsImpact) {
      toast.error(
        "Record the product impact assessment on the Investigation tab first.",
      );
      return;
    }
    setDeciding({ id: h.id, decision });
  }

  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold text-ink">Batch holds</h3>

      {isPending ? (
        <Loader2 className="size-4 animate-spin text-ink-5" />
      ) : holds.length === 0 ? (
        <p className="text-sm text-ink-5">No batches on hold.</p>
      ) : (
        <div className="scrollbar-slim overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-sunken text-left text-xs text-ink-4">
              <tr>
                <th className="px-3.5 py-2 font-semibold">Batch</th>
                <th className="px-3.5 py-2 font-semibold">Status</th>
                <th className="px-3.5 py-2 font-semibold">Placed</th>
                <th className="px-3.5 py-2 font-semibold">Decision</th>
                {canDecide && <th className="px-3.5 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft bg-surface">
              {holds.map((h) => (
                <HoldRow
                  key={h.id}
                  hold={h}
                  canDecide={canDecide}
                  deciding={deciding?.id === h.id ? deciding.decision : null}
                  onStart={(decision) => startDecision(h, decision)}
                  onCancel={() => setDeciding(null)}
                  onDecide={async (reason) => {
                    await decideHold(h.id, deciding!.decision, reason, viewerName);
                    await refresh();
                    toast.success(
                      `Batch ${h.batch_no} ${deciding!.decision === "released" ? "released" : "rejected"}.`,
                    );
                    setDeciding(null);
                  }}
                  investigationPending={
                    d.investigation_required !== false && !d.investigation_approved_at
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canDecide &&
        (adding ? (
          <AddHold
            onCancel={() => setAdding(false)}
            onAdd={async (batches) => {
              const n = await placeHolds(d.id, batches, viewerName);
              await refresh();
              toast.success(
                n === 0
                  ? "Already on hold."
                  : n === 1
                    ? "Hold placed."
                    : `${n} holds placed.`,
              );
              setAdding(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3.5 text-sm font-semibold text-ink-3 shadow-soft transition hover:border-brand hover:text-brand"
          >
            Put a batch on hold
          </button>
        ))}
    </section>
  );
}

function HoldRow({
  hold: h,
  canDecide,
  deciding,
  onStart,
  onCancel,
  onDecide,
  investigationPending,
}: {
  hold: BatchHold;
  canDecide: boolean;
  deciding: "released" | "rejected" | null;
  onStart: (decision: "released" | "rejected") => void;
  onCancel: () => void;
  onDecide: (reason: string) => Promise<void>;
  investigationPending: boolean;
}) {
  return (
    <>
      <tr className="align-top">
        <td className="px-3.5 py-2.5 font-mono">{h.batch_no}</td>
        <td className={cn("px-3.5 py-2.5", STATUS_TEXT[h.status])}>
          {HOLD_STATUS_LABEL[h.status]}
        </td>
        <td className="px-3.5 py-2.5 text-ink-3">
          {h.placed_by_name ?? "—"} · {formatDay(h.placed_at)}
        </td>
        <td className="px-3.5 py-2.5 text-ink-4">
          {h.decided_at ? (
            <>
              {h.decided_by_name ?? "—"} · {formatDateTime(h.decided_at)} —{" "}
              <span className="text-ink-3">{h.reason}</span>
            </>
          ) : (
            "—"
          )}
        </td>
        {canDecide && (
          <td className="whitespace-nowrap px-3.5 py-2.5 text-right">
            {h.status === "on_hold" && !deciding && (
              <>
                <button
                  type="button"
                  onClick={() => onStart("released")}
                  className="text-xs font-semibold text-brand hover:underline"
                >
                  Release
                </button>
                <span className="mx-1.5 text-ink-5">·</span>
                <button
                  type="button"
                  onClick={() => onStart("rejected")}
                  className="text-xs font-semibold text-danger-deep hover:underline"
                >
                  Reject
                </button>
              </>
            )}
          </td>
        )}
      </tr>
      {deciding && (
        <tr>
          <td colSpan={canDecide ? 5 : 4} className="bg-sunken px-3.5 py-3">
            <DecisionForm
              batch={h.batch_no}
              decision={deciding}
              warn={
                deciding === "released" && investigationPending
                  ? "The investigation is not approved yet."
                  : null
              }
              onCancel={onCancel}
              onDecide={onDecide}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function DecisionForm({
  batch,
  decision,
  warn,
  onCancel,
  onDecide,
}: {
  batch: string;
  decision: "released" | "rejected";
  warn: string | null;
  onCancel: () => void;
  onDecide: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const release = decision === "released";

  async function submit() {
    if (reason.trim().length < 5) {
      setError(
        release
          ? "Say why it is safe to release while the case is open."
          : "Give the reason for rejecting the batch.",
      );
      return;
    }
    setBusy(true);
    try {
      await onDecide(reason.trim());
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <label htmlFor={`hold-why-${batch}`} className="block text-sm font-semibold text-ink-2">
        {release
          ? `Release batch ${batch} — why is it safe to release while the case is open?`
          : `Reject batch ${batch} — reason for rejecting it`}
      </label>
      {warn && (
        <p className="rounded-lg border border-warn-line bg-warn-tint px-3 py-2 text-xs text-warn-ink">
          {warn} Releasing now is allowed, but say why in the reason.
        </p>
      )}
      {!release && (
        <p className="text-xs text-ink-5">
          A rejected batch stays blocked in the shift log for good — no
          preparatory or production work can be logged against it.
        </p>
      )}
      <textarea
        id={`hold-why-${batch}`}
        rows={2}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          if (error) setError(null);
        }}
        aria-invalid={Boolean(error)}
        className={AREA}
      />
      {error && (
        <p role="alert" className="text-xs font-medium text-danger-deep">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={submit} disabled={busy} className={PRIMARY_BUTTON}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {release ? "Release batch" : "Reject batch"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={SECONDARY_BUTTON}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddHold({
  onCancel,
  onAdd,
}: {
  onCancel: () => void;
  onAdd: (batches: string[]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const batches = splitBatches(text);
    if (batches.length === 0) {
      toast.error("Name the batch to put on hold.");
      return;
    }
    setBusy(true);
    try {
      await onAdd(batches);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5 rounded-xl border border-line bg-sunken p-3.5">
      <label htmlFor="hold-add" className="block text-sm font-semibold text-ink-2">
        Batch number(s), separated by commas
      </label>
      <input
        id="hold-add"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. 46690, 46691"
        autoComplete="off"
        className={CONTROL}
      />
      <p className="text-xs text-ink-5">
        Each batch must be in the product register. Its card goes On hold and
        the shift log refuses preparatory and production work against it.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={submit} disabled={busy} className={PRIMARY_BUTTON}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Put on hold
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={SECONDARY_BUTTON}>
          Cancel
        </button>
      </div>
    </div>
  );
}
