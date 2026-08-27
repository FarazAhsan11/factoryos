"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileUp,
  Loader2,
  Mail,
  MailWarning,
  Upload,
  XCircle,
} from "lucide-react";

import {
  importEmployees,
  type ImportRowResult,
} from "@/app/factory/[slug]/admin/employee-actions";
import {
  SHIFT_LABELS,
  type EmployeeRow,
} from "@/app/factory/[slug]/admin/schemas";
import {
  CSV_TEMPLATE,
  chunkRows,
  parseEmployeeCsv,
  type CsvRowError,
} from "@/lib/factory/employee-csv";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Emailing is one SMTP round-trip per person, so batches stay small when
 * invites are on: the panel then advances every few seconds instead of
 * appearing to hang. Silent imports are pure inserts and can go wider.
 */
const BATCH_WITH_INVITES = 3;
const BATCH_SILENT = 10;

type Stage = "pick" | "review" | "running" | "done";

/**
 * Bulk-import employees from a CSV, inviting them as they're created. The file
 * is written batch by batch through a Server Action, and every row's outcome
 * streams into the progress panel — created, invited, or skipped with a reason.
 * Anything whose email fails still lands as an account and can be re-invited
 * from the roster, so a flaky mailbox never costs you the import.
 */
export function EmployeeImportDialog({
  factoryId,
  onImported,
}: {
  factoryId: string;
  onImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("pick");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [parseErrors, setParseErrors] = useState<CsvRowError[]>([]);
  const [sendInvites, setSendInvites] = useState(true);
  const [results, setResults] = useState<ImportRowResult[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const cancelled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function resetAll() {
    setStage("pick");
    setFileName("");
    setRows([]);
    setParseErrors([]);
    setResults([]);
    setFatal(null);
    cancelled.current = false;
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFile(file: File) {
    const text = await file.text();
    const parsed = parseEmployeeCsv(text);
    setFileName(file.name);
    setRows(parsed.rows);
    setParseErrors(parsed.errors);
    setStage("review");
  }

  async function run() {
    cancelled.current = false;
    setStage("running");
    setResults([]);
    setFatal(null);

    const batches = chunkRows(
      rows,
      sendInvites ? BATCH_WITH_INVITES : BATCH_SILENT,
    );
    const collected: ImportRowResult[] = [];

    for (const batch of batches) {
      if (cancelled.current) break;

      let result;
      try {
        result = await importEmployees({ factoryId, rows: batch, sendInvites });
      } catch (e) {
        // Network drop / action crash — keep everything done so far.
        setFatal(
          e instanceof Error
            ? `Import stopped: ${e.message}`
            : "Import stopped unexpectedly.",
        );
        break;
      }

      if ("error" in result) {
        setFatal(result.error);
        break;
      }

      collected.push(...result.results);
      setResults([...collected]);
      // Refresh as we go so the roster fills in behind the dialog.
      onImported();
    }

    setStage("done");
    onImported();
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(
      new Blob([CSV_TEMPLATE], { type: "text/csv" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "factoryos-employees-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const done = results.length;
  const invited = results.filter((r) => r.invited).length;
  const created = results.filter((r) => r.ok).length;
  const noEmail = results.filter((r) => r.ok && !r.invited);
  const failed = results.filter((r) => !r.ok);
  const percent = rows.length ? Math.round((done / rows.length) * 100) : 0;
  const current = rows[done];

  return (
    <>
      <button
        type="button"
        onClick={() => {
          resetAll();
          setOpen(true);
        }}
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink-3 transition hover:bg-sunken"
      >
        <Upload className="size-4" />
        Import CSV
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          // Never abandon a run half-way by clicking outside.
          if (!next && stage === "running") return;
          setOpen(next);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-ink">Import employees</DialogTitle>
            <DialogDescription>
              Upload a CSV of names, emails and roles. Each person gets an
              account, and an invite if you want one sent.
            </DialogDescription>
          </DialogHeader>

          {stage === "pick" && (
            <div className="space-y-3">
              <label
                htmlFor="emp-csv"
                className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-ink-6 bg-sunken px-4 py-10 text-center transition hover:border-brand hover:bg-brand-tint"
              >
                <FileUp className="size-6 text-ink-5" />
                <span className="text-sm font-medium text-ink">
                  Choose a CSV file
                </span>
                <span className="text-xs text-ink-5">
                  Columns: name, email, role (admin or operator), shift
                  (morning, afternoon or both)
                </span>
              </label>
              <input
                id="emp-csv"
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
              <button
                type="button"
                onClick={downloadTemplate}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-brand transition hover:underline"
              >
                <Download className="size-3.5" />
                Download a template
              </button>
            </div>
          )}

          {stage === "review" && (
            <div className="space-y-3">
              <div className="rounded-xl border border-line bg-sunken px-4 py-3 text-sm">
                <p className="font-medium text-ink">{fileName}</p>
                <p className="mt-0.5 text-ink-4">
                  <strong className="text-ink">{rows.length}</strong> row
                  {rows.length === 1 ? "" : "s"} ready to import
                  {parseErrors.length > 0 &&
                    ` · ${parseErrors.length} will be skipped`}
                </p>
              </div>

              {parseErrors.length > 0 && (
                <ProblemList title="Rows that can't be imported">
                  {parseErrors.slice(0, 8).map((e) => (
                    <li key={`${e.line}-${e.value}`}>
                      <span className="font-medium">Line {e.line}</span>{" "}
                      {e.value && `(${e.value}) `}— {e.message}
                    </li>
                  ))}
                  {parseErrors.length > 8 && (
                    <li>…and {parseErrors.length - 8} more.</li>
                  )}
                </ProblemList>
              )}

              {rows.length > 0 && (
                <ul className="max-h-36 overflow-y-auto rounded-xl border border-line text-sm">
                  {rows.slice(0, 50).map((r) => (
                    <li
                      key={r.email}
                      className="flex items-center justify-between gap-3 border-b border-sunken-2 px-3.5 py-2 last:border-0"
                    >
                      <span className="min-w-0 flex-1 truncate text-ink">
                        {r.fullName}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-ink-4">
                        {r.email}
                      </span>
                      <span className="shrink-0 rounded-full bg-sunken-2 px-2 py-0.5 text-[11px] text-ink-3">
                        {r.role}
                      </span>
                      <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] text-brand">
                        {SHIFT_LABELS[r.defaultShift]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-sunken p-3 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={sendInvites}
                  onChange={(e) => setSendInvites(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-ink-6 accent-brand"
                />
                <span>
                  Email everyone their invite as they&rsquo;re added
                  <span className="mt-0.5 block text-xs text-ink-5">
                    Roughly a second per person — {rows.length} row
                    {rows.length === 1 ? "" : "s"} will take a moment. Untick to
                    create the accounts now and invite people from the list
                    later.
                  </span>
                </span>
              </label>

              <div className="flex justify-end gap-2 pt-1">
                <GhostButton onClick={resetAll}>
                  Choose another file
                </GhostButton>
                <PrimaryButton onClick={run} disabled={rows.length === 0}>
                  {sendInvites ? "Import & invite" : "Import"}{" "}
                  {rows.length || ""}
                </PrimaryButton>
              </div>
            </div>
          )}

          {stage === "running" && (
            <div className="space-y-3">
              <div className="rounded-2xl border border-line bg-sunken p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-ink">
                  <Loader2 className="size-4 animate-spin text-brand" />
                  {sendInvites
                    ? "Creating accounts and sending invites…"
                    : "Creating accounts…"}
                </div>

                <div
                  role="progressbar"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Import progress"
                  className="mt-3 h-2 overflow-hidden rounded-full bg-line"
                >
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] transition-[width] duration-300"
                    style={{ width: `${percent}%` }}
                  />
                </div>

                <div className="mt-2 flex items-center justify-between text-xs text-ink-4">
                  <span>
                    {done} of {rows.length} processed
                  </span>
                  <span>
                    {invited > 0 && `${invited} invited · `}
                    {created} created
                    {failed.length > 0 && ` · ${failed.length} skipped`}
                  </span>
                </div>

                {current && (
                  <p className="mt-2 truncate text-xs text-ink-5">
                    Working on {current.email}…
                  </p>
                )}
              </div>

              {/* Live log — newest first, so the latest row is always visible. */}
              {results.length > 0 && (
                <ul className="max-h-40 overflow-y-auto rounded-xl border border-line text-sm">
                  {[...results].reverse().map((r) => (
                    <ResultRow key={r.email} result={r} />
                  ))}
                </ul>
              )}

              <div className="flex items-center justify-between">
                <p className="text-xs text-ink-5">
                  Keep this window open until it finishes.
                </p>
                <GhostButton
                  onClick={() => {
                    cancelled.current = true;
                  }}
                >
                  Stop after this batch
                </GhostButton>
              </div>
            </div>
          )}

          {stage === "done" && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-2xl border border-teal-line bg-teal-soft p-4">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-teal" />
                <div className="text-sm">
                  <p className="font-semibold text-ink">
                    {created} account{created === 1 ? "" : "s"} created
                    {sendInvites &&
                      ` · ${invited} invite${invited === 1 ? "" : "s"} sent`}
                  </p>
                  <p className="mt-0.5 text-ink-3">
                    {noEmail.length > 0
                      ? `${noEmail.length} still need an invite — use Send invite on their row.`
                      : sendInvites
                        ? "Everyone has been emailed a link to set their password."
                        : "They show as Not invited until you send each invite."}
                  </p>
                </div>
              </div>

              {fatal && (
                <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-deep">
                  {fatal}
                </p>
              )}

              {(failed.length > 0 || noEmail.length > 0) && (
                <ul className="max-h-44 overflow-y-auto rounded-xl border border-line text-sm">
                  {[...noEmail, ...failed].map((r) => (
                    <ResultRow key={r.email} result={r} />
                  ))}
                </ul>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <GhostButton onClick={resetAll}>
                  Import another file
                </GhostButton>
                <PrimaryButton onClick={() => setOpen(false)}>
                  Done
                </PrimaryButton>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** One line of the live log: what happened to this address, and why. */
function ResultRow({ result }: { result: ImportRowResult }) {
  const tone = !result.ok
    ? {
        Icon: XCircle,
        color: "text-danger-deep",
        label: result.error ?? "Skipped",
      }
    : result.invited
      ? { Icon: Mail, color: "text-teal", label: "Invited" }
      : {
          Icon: result.error ? MailWarning : CheckCircle2,
          color: result.error ? "text-warn-deep" : "text-teal",
          label: result.error ?? "Created",
        };

  return (
    <li className="flex items-start gap-2 border-b border-sunken-2 px-3.5 py-2 last:border-0">
      <tone.Icon className={`mt-0.5 size-3.5 shrink-0 ${tone.color}`} />
      <span className="min-w-0 flex-1 truncate text-ink">{result.email}</span>
      <span className={`shrink-0 text-xs ${tone.color}`}>{tone.label}</span>
    </li>
  );
}

function ProblemList({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-warn-line bg-warn-tint p-3 text-xs text-warn-ink">
      <p className="mb-1.5 flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="size-3.5" />
        {title}
      </p>
      <ul className="max-h-32 space-y-0.5 overflow-y-auto">{children}</ul>
    </div>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function GhostButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-10 rounded-xl px-4 text-sm font-medium text-ink-3 transition hover:bg-sunken-2"
    >
      {children}
    </button>
  );
}
