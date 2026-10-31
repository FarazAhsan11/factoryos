"use client";

import { useQuery } from "@tanstack/react-query";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/factory/dates";
import {
  amendmentKeys,
  changeLabel,
  changeValue,
  fetchAmendments,
  type ShiftLogAmendment,
} from "@/lib/factory/shift-log-amendments";
import {
  formatReportDate,
  type ShiftReportRow,
} from "@/lib/factory/shift-report-queries";

const HEADINGS = [
  "Date",
  "Time",
  "What was amended",
  "Reason for amendment",
  "Amended by",
];

/**
 * Shift report → an entry's amendment history.
 *
 * Read-only, and open to anyone who can read the sheet: the pencil beside it
 * needs standing to correct an entry, but what was corrected is part of the
 * record. See `shift-log-amendments.ts` for where the rows come from.
 */
export function AmendmentHistoryDialog({
  entry,
  factoryId,
  unitWord,
  onClose,
}: {
  /** Null closes the dialog; setting one opens it on that entry. */
  entry: ShiftReportRow | null;
  factoryId: string;
  unitWord: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="w-[min(60rem,calc(100vw-2rem))] max-w-none print:hidden">
        <DialogHeader>
          <DialogTitle className="text-ink">Amendment history</DialogTitle>
          <DialogDescription>
            {entry && (
              <>
                {entry.unit_name ?? "—"} · {entry.process_name ?? "—"}
                {entry.batch_no && ` · batch ${entry.batch_no}`} ·{" "}
                {formatReportDate(entry.log_date)}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {entry && (
          <History
            key={entry.id}
            entryId={entry.id}
            factoryId={factoryId}
            unitWord={unitWord}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function History({
  entryId,
  factoryId,
  unitWord,
}: {
  entryId: string;
  factoryId: string;
  unitWord: string;
}) {
  const {
    data: amendments = [],
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: amendmentKeys.entry(factoryId, entryId),
    queryFn: () => fetchAmendments(entryId),
    // Fresh on every opening, whatever the default: someone else may have
    // amended the entry, and a history must not read a step behind.
    staleTime: 0,
  });

  if (isError) {
    return (
      <p className="rounded-xl border border-danger-line bg-danger-soft px-4 py-6 text-center text-sm text-danger-deep">
        Could not load the amendment history: {(error as Error).message}
      </p>
    );
  }
  if (isPending) {
    return <div className="h-32 animate-pulse rounded-xl bg-sunken" />;
  }
  if (amendments.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-sunken px-4 py-8 text-center text-sm text-ink-4">
        No amendments are recorded for this entry.
      </p>
    );
  }

  return (
    <div className="scrollbar-slim max-h-[60vh] overflow-auto rounded-xl border border-line">
      <table className="w-full min-w-[42rem] border-collapse text-[0.75rem]">
        <thead>
          <tr>
            {HEADINGS.map((heading) => (
              <th
                key={heading}
                scope="col"
                className="sticky top-0 bg-sunken-2 px-3 py-2 text-left text-[0.625rem] font-bold tracking-[0.06em] whitespace-nowrap text-ink-4 uppercase"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {amendments.map((amendment) => (
            <Row
              key={amendment.id}
              amendment={amendment}
              unitWord={unitWord}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  amendment,
  unitWord,
}: {
  amendment: ShiftLogAmendment;
  unitWord: string;
}) {
  const [date, time] = amendment.amended_at
    ? formatDateTime(amendment.amended_at).split(", ")
    : [formatReportDate(amendment.amended_on), "—"];

  return (
    <tr className="border-t border-line-soft align-top">
      <td className="px-3 py-2 whitespace-nowrap text-ink-2">{date}</td>
      <td className="px-3 py-2 font-mono text-[0.6875rem] text-ink-3">
        {time}
      </td>
      <td className="px-3 py-2 text-ink-2">
        <Changes amendment={amendment} unitWord={unitWord} />
      </td>
      <td className="px-3 py-2 break-words whitespace-pre-line text-ink-2">
        {amendment.reason ?? "—"}
      </td>
      <td className="px-3 py-2 text-ink-2">
        {amendment.amended_by_name ?? <NotRecorded />}
      </td>
    </tr>
  );
}

function Changes({
  amendment,
  unitWord,
}: {
  amendment: ShiftLogAmendment;
  unitWord: string;
}) {
  const { changes } = amendment;
  if (changes === null) return <NotRecorded />;
  if (changes.length === 0) {
    return <span className="text-ink-4">Note only — figures unchanged</span>;
  }
  return (
    <ul className="space-y-0.5">
      {changes.map((change) => (
        <li key={change.field}>
          <span className="font-medium">
            {changeLabel(change.field, unitWord)}:
          </span>{" "}
          <span className="text-ink-4">
            {changeValue(change.field, change.from)}
          </span>{" "}
          → {changeValue(change.field, change.to)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Said outright rather than left blank. An amendment made before this history
 * was kept (0055) really has no record of this, and an audit reader should be
 * told that, not left to wonder whether the sheet failed to load it.
 */
function NotRecorded() {
  return <span className="text-ink-5 italic">Not recorded</span>;
}
