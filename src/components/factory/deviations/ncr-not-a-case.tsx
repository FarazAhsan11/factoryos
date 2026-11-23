"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { notACaseSchema } from "@/app/factory/[slug]/deviations/schemas";
import {
  AREA,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from "@/components/factory/deviations/deviation-fields";
import {
  closeNcrNotACase,
  deviationKeys,
  type Deviation,
} from "@/lib/factory/deviation-queries";
import { holdKeys } from "@/lib/factory/hold-queries";
import { pipelineKeys } from "@/lib/factory/pipeline-queries";

/**
 * "Close — not a non-conformance" (qms-v12): raised in error, a duplicate, or
 * — found at QC testing — a lab error, so the result was invalid. The reason
 * is asked in place, not in a popup; `close_ncr_not_a_case` releases anything
 * held and closes the case.
 */
export function NotACaseButton({
  deviation: d,
  factoryId,
  viewerName,
  label = "Close — not a non-conformance",
}: {
  deviation: Deviation;
  factoryId: string;
  viewerName: string;
  label?: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const what = d.type === "complaint" ? "quality complaint" : "non-conformance";

  async function submit() {
    const parsed = notACaseSchema.safeParse({ reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Say why.");
      return;
    }
    setBusy(true);
    try {
      await closeNcrNotACase(d.id, parsed.data.reason, viewerName);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) }),
        queryClient.invalidateQueries({ queryKey: holdKeys.forCase(factoryId, d.id) }),
        queryClient.invalidateQueries({ queryKey: pipelineKeys.all(factoryId) }),
      ]);
      toast.success(`${d.deviation_no} closed — not a ${what}.`);
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={SECONDARY_BUTTON}>
        {label}
      </button>
    );
  }

  return (
    <div className="w-full space-y-2.5 rounded-xl border border-line bg-sunken p-3.5">
      <label htmlFor={`not-case-${d.id}`} className="block text-sm font-semibold text-ink-2">
        Why is this not a {what}?
      </label>
      <textarea
        id={`not-case-${d.id}`}
        rows={2}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          if (error) setError(null);
        }}
        placeholder={
          d.type === "complaint"
            ? "e.g. Product enquiry, answered by email; delivery or pricing question"
            : "e.g. Raised in error; duplicate of NCR-2026-011; lab error found (OOS-2026-017)"
        }
        aria-invalid={Boolean(error)}
        className={AREA}
      />
      {error && (
        <p role="alert" className="text-xs font-medium text-danger-deep">
          {error}
        </p>
      )}
      <p className="text-xs text-ink-5">
        Anything still on hold or in quarantine is released. The case closes as
        signed by {viewerName || "you"}.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={submit} disabled={busy} className={PRIMARY_BUTTON}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Close as not a {what}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className={SECONDARY_BUTTON}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
