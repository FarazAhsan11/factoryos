"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  AREA,
  Fact,
  Group,
  Muted,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from "@/components/factory/deviations/deviation-fields";
import { regulatorOf } from "@/lib/factory/complaint";
import { formatDay } from "@/lib/factory/dates";
import {
  ackDue,
  acknowledgeComplaint,
  deviationKeys,
  markSampleReceived,
  type Deviation,
} from "@/lib/factory/deviation-queries";
import { useQualitySettings } from "@/lib/factory/quality-settings-queries";
import { useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

/** Today, `YYYY-MM-DD`. */
const todayKey = () => {
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
};

/** A complaint's raise answers, read-only, in the raise form's order. */
export function ComplaintInitiationFacts({ deviation: d }: { deviation: Deviation }) {
  const yn = (b: boolean | null) => (b === null ? <Muted>—</Muted> : b ? "Yes" : "No");
  const reg = regulatorOf(d.country);
  return (
    <div className="space-y-6">
      <Group title="Complaint">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact label="Title" wide>
            {d.title}
          </Fact>
          <Fact label="Date received">
            {d.received_on ? formatDay(d.received_on) : <Muted>Not recorded</Muted>}
          </Fact>
          <Fact label="Received via">{d.received_via ?? <Muted>—</Muted>}</Fact>
          <Fact label="Complainant">{d.complainant ?? <Muted>—</Muted>}</Fact>
          <Fact label="Complainant contact">
            {d.complainant_contact ?? <Muted>—</Muted>}
          </Fact>
          <Fact label="Market (country)">
            {d.country ? (
              <>
                {d.country}
                <span className="text-ink-5"> · {reg === "regulator" ? "its regulator" : reg}</span>
              </>
            ) : (
              <Muted>—</Muted>
            )}
          </Fact>
          <Fact label="Batch number(s)" mono>
            {d.batch_nos.length > 0 ? d.batch_nos.join(", ") : <Muted>—</Muted>}
          </Fact>
          <Fact label="Product">
            {d.product_names.length > 0
              ? d.product_names.join(", ")
              : (d.product_label ?? <Muted>—</Muted>)}
          </Fact>
          <Fact label="Brand owner">{d.customer_name ?? <Muted>—</Muted>}</Fact>
          <Fact label="Sponsor">
            {d.sponsor === "us" ? "Us" : d.sponsor === "customer" ? (d.customer_name ?? "The customer") : <Muted>—</Muted>}
          </Fact>
          <Fact label="ARTG number" mono>
            {d.artg_no ?? <Muted>—</Muted>}
          </Fact>
          <Fact label="Expiry date">{d.expiry ?? <Muted>—</Muted>}</Fact>
          <Fact label="Number of units affected">{d.qty_affected ?? <Muted>—</Muted>}</Fact>
          <Fact label="Complaint description" wide>
            {d.actual}
          </Fact>
          <Fact label="Injury or adverse reaction">{yn(d.adverse_reaction)}</Fact>
          {d.adverse_reaction && (
            <>
              <Fact label="Serious">{yn(d.adverse_serious)}</Fact>
              <Fact label="What reaction, and when" wide>
                {d.adverse_what ?? <Muted>—</Muted>}
              </Fact>
            </>
          )}
          <Fact label="Complaint sample">{d.sample ?? <Muted>—</Muted>}</Fact>
          <Fact label="Immediate action" wide>
            {d.immediate_action ?? <Muted>None recorded</Muted>}
          </Fact>
          <Fact label="Raised by">{d.raised_by ?? <Muted>—</Muted>}</Fact>
        </dl>
      </Group>
    </div>
  );
}

/**
 * Communication (qms-v12 "v11"): the acknowledgement to the complainant — its
 * due date from day one, and "Mark acknowledged" (how; late needs why) — and
 * the complaint sample — a requested one is marked received when it arrives.
 * Asked in place, not in a popup.
 */
export function ComplaintCommunication({
  deviation: d,
  factoryId,
  canEdit,
  viewerName,
}: {
  deviation: Deviation;
  factoryId: string;
  canEdit: boolean;
  viewerName: string;
}) {
  const queryClient = useQueryClient();
  const settings = useQualitySettings(factoryId);
  const today = useRenderClock(todayKey);
  const due = ackDue(d, settings.ackDays);
  const late = today > due;
  const open = d.status === "open";
  const [acking, setAcking] = useState(false);
  const [how, setHow] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });

  async function acknowledge() {
    if (late && how.trim().length < 10) {
      toast.error("Say how it was acknowledged, and why it was late.");
      return;
    }
    setBusy(true);
    try {
      await acknowledgeComplaint(d.id, how, viewerName);
      await refresh();
      toast.success(late ? "Acknowledgement recorded (late)." : "Acknowledgement recorded.");
      setAcking(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sampleIn() {
    setBusy(true);
    try {
      await markSampleReceived(d.id);
      await refresh();
      toast.success("Sample marked received.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ackLate = d.ack_on !== null && d.ack_on > due;

  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold text-ink">Communication</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line-soft bg-sunken px-4 py-3">
          <p className="text-xs font-medium text-ink-4">Acknowledgement to the complainant</p>
          {d.ack_on ? (
            <p className={cn("mt-1 flex items-center gap-1.5 text-sm", ackLate ? "text-warn-deep" : "text-teal-deep")}>
              <CheckCircle2 className="size-4 shrink-0" />
              Acknowledged {formatDay(d.ack_on)}
              {ackLate && " (late)"}
              {d.ack_how && <span className="text-ink-4"> · {d.ack_how}</span>}
            </p>
          ) : open ? (
            <div className="mt-1 space-y-2">
              <p className="text-sm">
                <span className={cn("font-semibold", late ? "text-danger-deep" : "text-warn-deep")}>
                  Acknowledge by {formatDay(due)}
                </span>
                <span className="text-ink-4">
                  {" "}
                  · {settings.ackDays} days after receipt (SOP)
                </span>
              </p>
              {canEdit &&
                (acking ? (
                  <div className="space-y-2">
                    <label htmlFor="ack-how" className="block text-xs font-medium text-ink-3">
                      {late ? "How was it acknowledged, and why late?" : "How was it acknowledged?"}
                    </label>
                    <textarea
                      id="ack-how"
                      rows={2}
                      value={how}
                      onChange={(e) => setHow(e.target.value)}
                      placeholder={late ? "" : "Email to the complainant"}
                      className={AREA}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={acknowledge} disabled={busy} className={PRIMARY_BUTTON}>
                        {busy && <Loader2 className="size-4 animate-spin" />}
                        Mark acknowledged
                      </button>
                      <button
                        type="button"
                        onClick={() => setAcking(false)}
                        disabled={busy}
                        className={SECONDARY_BUTTON}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setAcking(true)} className={SECONDARY_BUTTON}>
                    Mark acknowledged
                  </button>
                ))}
            </div>
          ) : (
            <p className="mt-1 text-sm text-ink-5">Not recorded</p>
          )}
        </div>

        <div className="rounded-xl border border-line-soft bg-sunken px-4 py-3">
          <p className="text-xs font-medium text-ink-4">Complaint sample</p>
          {d.sample === "Received" ? (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-teal-deep">
              <CheckCircle2 className="size-4 shrink-0" />
              Received{d.sample_received_on && ` ${formatDay(d.sample_received_on)}`}
            </p>
          ) : d.sample === "Requested" ? (
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-warn-deep">
                Requested — not received yet
              </span>
              {canEdit && open && (
                <button type="button" onClick={sampleIn} disabled={busy} className={SECONDARY_BUTTON}>
                  Mark received
                </button>
              )}
            </div>
          ) : (
            <p className="mt-1 text-sm text-ink-5">{d.sample ?? "Not recorded"}</p>
          )}
        </div>
      </div>
    </section>
  );
}
