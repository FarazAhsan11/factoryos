"use client";

import { useState } from "react";
import { Check, Circle, Dot, Loader2, Minus, Pencil } from "lucide-react";
import { toast } from "sonner";

import type { FactoryRole } from "@/lib/factory/context";
import {
  ACTION_STAGES,
  STAGE_BLURBS,
  STAGE_LABELS,
  canAmend,
  formatDue,
  isStageSkipped,
  stageIndex,
  updateEvidence,
  verificationLabel,
  type ActionStage,
  type EvidenceField,
  type FactoryAction,
} from "@/lib/factory/action-queries";
import { cn } from "@/lib/utils";

/**
 * The five stages down the side of the dialog, with what each one produced.
 *
 * This is the half of the flow that makes the extra clicks worth anything.
 * Three statuses and a note thread meant the answer to "why did this happen
 * and what did we do?" was somewhere in a scroll of comments, if it was
 * anywhere. Here the root cause sits under Investigating, the fix under Action
 * taken and the sign-off under Verification, permanently, because that is
 * where the form put them.
 *
 * Stages ahead of the current one are shown greyed rather than hidden: the
 * point is partly to tell someone what still has to happen.
 *
 * An issue that took the short road — closed with no investigation — is the
 * one case where a passed stage is not a completed one. The three middle
 * stages are drawn as *skipped*, greyed and struck through, never ticked: a
 * green check under "Action taken" on an issue nobody investigated
 * would be the timeline inventing a CAPA that never happened, and this screen
 * is the record.
 *
 * Recorded text is editable in place. Freezing it would leave known-wrong
 * entries nobody can fix, which is how people learn to write nothing much in
 * the box; the trigger keeps every previous version in the thread, so a
 * correction can't become a quiet re-authoring.
 */
export function ActionStageTimeline({
  action,
  role,
  onSaved,
}: {
  action: FactoryAction;
  role: FactoryRole;
  onSaved: () => Promise<void> | void;
}) {
  const current = stageIndex(action.status);
  const amendable = canAmend(action, role);

  return (
    <ol className="space-y-0">
      {ACTION_STAGES.map((stage, i) => {
        const skipped = isStageSkipped(action, stage);
        const done = i < current && !skipped;
        const active = i === current;
        // A skipped stage produced nothing, so it shows nothing — an owner
        // named before the issue was resolved outright is not the output of
        // an investigation that never ran.
        const evidence = skipped ? [] : evidenceFor(action, stage);
        const stamp = stampFor(action, stage);
        // The rail runs green only into a stage that actually happened, so a
        // skipped stretch reads as the detour it was.
        const railDone =
          done && !isStageSkipped(action, ACTION_STAGES[i + 1]);

        return (
          <li key={stage} className="flex gap-3">
            {/* Rail: a dot per stage, joined by a line that stops at the last
                one. Coloured only as far as the issue has actually got. */}
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border-2",
                  done
                    ? "border-[#16A34A] bg-[#16A34A] text-white"
                    : active
                      ? "border-[#2563EB] bg-white text-[#2563EB]"
                      : "border-[#E6EAF1] bg-white text-[#CBD5E1]"
                )}
              >
                {done ? (
                  <Check className="size-3.5" />
                ) : skipped ? (
                  <Minus className="size-3.5" />
                ) : active ? (
                  <Circle className="size-2.5 fill-current" />
                ) : (
                  <Dot className="size-3.5" />
                )}
              </span>
              {i < ACTION_STAGES.length - 1 && (
                <span
                  className={cn(
                    "w-0.5 flex-1",
                    railDone ? "bg-[#16A34A]" : "bg-[#E6EAF1]"
                  )}
                />
              )}
            </div>

            <div className={cn("min-w-0 flex-1 pb-4", i === ACTION_STAGES.length - 1 && "pb-0")}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p
                  className={cn(
                    "text-[13px] font-semibold",
                    skipped
                      ? "text-[#94A3B8] line-through"
                      : done || active
                        ? "text-[#0F1B34]"
                        : "text-[#94A3B8]"
                  )}
                >
                  {STAGE_LABELS[stage]}
                </p>
                {skipped && (
                  <span className="text-[11px] text-[#94A3B8]">Skipped</span>
                )}
                {stamp && (
                  <span className="text-[11px] text-[#94A3B8]">
                    {formatDue(stamp)}
                  </span>
                )}
              </div>

              {active && (
                <p className="mt-0.5 text-[11.5px] text-[#64748B]">
                  {blurbFor(action, stage)}
                </p>
              )}

              {evidence.length > 0 && (
                <dl className="mt-1.5 space-y-2 rounded-xl border border-[#E6EAF1] bg-[#FBFCFE] p-3">
                  {evidence.map((row) => (
                    <Evidence
                      key={row.label}
                      row={row}
                      actionId={action.id}
                      editable={amendable && row.field !== undefined}
                      onSaved={onSaved}
                    />
                  ))}
                </dl>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** When the issue entered this stage — the one date worth showing per step. */
function stampFor(action: FactoryAction, stage: ActionStage): string | null {
  switch (stage) {
    case "open":
      return action.created_at;
    case "investigating":
      return action.investigating_at;
    case "action_taken":
      return action.action_taken_at;
    case "verification":
      return action.verification_at;
    case "closed":
      return action.closed_at;
  }
}

/** What the current stage is for — reworded when the short road was taken. */
function blurbFor(action: FactoryAction, stage: ActionStage): string {
  if (stage === "closed" && action.resolved_direct) {
    return "Dealt with directly — no investigation was needed.";
  }
  return STAGE_BLURBS[stage];
}

interface EvidenceRow {
  label: string;
  value: string;
  /** Present only on the four fields a stage records — the editable ones. */
  field?: EvidenceField;
}

/**
 * What was recorded *during* a stage, which is not always what was recorded to
 * leave it. The root cause is the investigation's output and belongs under
 * Investigating, even though it is collected on the way out of it.
 *
 * `Raised with` carries no `field`: it is the shift log's own words, and not
 * this screen's to rewrite. The owner is not here at all — it is a fact about
 * the issue rather than something a stage produced, so it lives in the record
 * tab's facts alongside the dates, with its own control.
 */
function evidenceFor(action: FactoryAction, stage: ActionStage): EvidenceRow[] {
  const rows: EvidenceRow[] = [];

  if (stage === "open" && action.notes) {
    rows.push({ label: "Raised with", value: action.notes });
  }
  if (stage === "investigating") {
    if (action.root_cause) {
      rows.push({
        label: "Root cause",
        value: action.root_cause,
        field: "root_cause",
      });
    }
  }
  if (stage === "action_taken") {
    if (action.corrective_action) {
      rows.push({
        label: "Corrective action",
        value: action.corrective_action,
        field: "corrective_action",
      });
    }
    if (action.preventive_action) {
      rows.push({
        label: "Preventive action",
        value: action.preventive_action,
        field: "preventive_action",
      });
    }
  }
  // The sign-off is typed at Verification and files there — except on the
  // short road, where that stage never happened. Then the same column holds a
  // *resolution*, and it belongs under Closed, which is the only stage that
  // issue actually reached. Calling it a verification would claim a fix was
  // tested when there was no fix to test.
  const verifyStage = action.resolved_direct ? "closed" : "verification";
  if (stage === verifyStage && action.verification) {
    rows.push({
      label: verificationLabel(action),
      value: action.verification,
      field: "verification",
    });
  }

  return rows;
}

/**
 * One recorded field, with an edit affordance when the viewer may correct it.
 *
 * Kept as plain local state rather than RHF: it is a single textarea whose
 * only rule — not empty — the trigger already states better than a schema
 * could, and mounting a form per row would cost a hook per field.
 */
function Evidence({
  row,
  actionId,
  editable,
  onSaved,
}: {
  row: EvidenceRow;
  actionId: string;
  editable: boolean;
  onSaved: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.value);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!row.field) return;
    setSaving(true);
    try {
      await updateEvidence(actionId, row.field, draft);
      await onSaved();
      setEditing(false);
      toast.success(`${row.label} updated.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <dt className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.5px] text-[#94A3B8]">
        {row.label}
        {editable && !editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(row.value);
              setEditing(true);
            }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-[#64748B] transition hover:bg-white hover:text-[#2563EB]"
          >
            <Pencil className="size-3" />
            Edit
          </button>
        )}
      </dt>

      {editing ? (
        <div className="mt-1 space-y-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-[#E6EAF1] bg-white px-3 py-2 text-[13px] text-[#0F1B34] outline-none transition focus:border-[#2563EB]"
          />
          {/* The previous text is kept in the thread, so this is a correction
              with a paper trail rather than an overwrite. Saying so is what
              makes it safe to use. */}
          <p className="text-[10.5px] text-[#94A3B8]">
            The current text is kept in the notes below.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving || draft.trim() === row.value.trim()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 text-[11.5px] font-semibold text-white transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-40"
            >
              {saving && <Loader2 className="size-3 animate-spin" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="h-8 rounded-lg border border-[#E6EAF1] bg-white px-3 text-[11.5px] font-medium text-[#475569] transition hover:border-[#2563EB] hover:text-[#2563EB] disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <dd className="whitespace-pre-wrap text-[13px] text-[#0F1B34]">
          {row.value}
        </dd>
      )}
    </div>
  );
}
