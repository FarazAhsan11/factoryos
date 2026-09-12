"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileUp,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";

import type { ProductValues } from "@/app/factory/[slug]/admin/schemas";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CsvRowError } from "@/lib/factory/csv";
import { formatDay } from "@/lib/factory/dates";
import {
  parseProductCsv,
  productCsvTemplate,
  splitExisting,
  type ReadColumn,
} from "@/lib/factory/product-csv";
import {
  createProducts,
  type ProductImportResult,
} from "@/lib/factory/product-queries";

type Stage = "input" | "review" | "running" | "done";

/**
 * Bulk-import batches into the product catalogue from a CSV.
 *
 * A "paste from Excel" tab was built alongside this and removed. A clipboard
 * paste carries no filename, no reliable delimiter and — the real problem — no
 * guarantee of column count, so a three-column selection shifted every value
 * one place left and imported plausible rows with the product name in `code`
 * and a required quantity of 0. Save As → CSV is one extra step that makes the
 * input a known shape.
 *
 * Nothing is written until the review step has said what will happen: how many
 * rows are ready, which lines can't be read, and which batches the catalogue
 * already holds. Existing batches are skipped rather than overwritten — a
 * re-uploaded sheet must not quietly reset a required quantity that production
 * has been logging against.
 */
export function ProductImportDialog({
  factoryId,
  existingBatchNos,
  onImported,
}: {
  factoryId: string;
  /** The catalogue as already loaded by the panel, for the duplicate check. */
  existingBatchNos: string[];
  onImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("input");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ProductValues[]>([]);
  const [duplicates, setDuplicates] = useState<ProductValues[]>([]);
  const [parseErrors, setParseErrors] = useState<CsvRowError[]>([]);
  const [read, setRead] = useState<ReadColumn[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [results, setResults] = useState<ProductImportResult[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function resetAll() {
    setStage("input");
    setFileName("");
    setRows([]);
    setDuplicates([]);
    setParseErrors([]);
    setRead([]);
    setIgnored([]);
    setResults([]);
    setFatal(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  /** Parse → split off what the catalogue already has → show the review. */
  function review(text: string, name: string) {
    const parsed = parseProductCsv(text);
    const { fresh, duplicates: dupes } = splitExisting(
      parsed.rows,
      existingBatchNos,
    );
    setFileName(name);
    setRows(fresh);
    setDuplicates(dupes);
    setParseErrors(parsed.errors);
    setRead(parsed.read);
    setIgnored(parsed.ignored);
    setStage("review");
  }

  async function handleFile(file: File) {
    review(await file.text(), file.name);
  }

  async function run() {
    setStage("running");
    setResults([]);
    setFatal(null);

    try {
      const outcome = await createProducts(factoryId, rows);
      setResults(outcome);
    } catch (e) {
      setFatal(
        e instanceof Error
          ? `Import stopped: ${e.message}`
          : "Import stopped unexpectedly.",
      );
    }

    setStage("done");
    onImported();
  }

  function downloadTemplate() {
    // Built at click time so the example dates are always still ahead.
    const url = URL.createObjectURL(
      new Blob([productCsvTemplate()], { type: "text/csv" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "factoryos-products-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const added = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

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
        Bulk import
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
            <DialogTitle className="text-ink">Import products</DialogTitle>
            <DialogDescription>
              Upload a CSV of batches. Existing batch numbers are skipped, so
              re-uploading a sheet never overwrites what production has been
              logging against.
            </DialogDescription>
          </DialogHeader>

          {stage === "input" && (
            <div className="space-y-3">
              <label
                htmlFor="product-csv"
                className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-10 text-center transition hover:border-brand hover:bg-brand-tint"
              >
                <FileUp className="size-6 text-ink-5" />
                <span className="text-sm font-medium text-ink">
                  Choose a CSV file
                </span>
                <span className="text-xs text-ink-5">
                  Needs a batch and a product name. Also reads product code,
                  work order, required qty, the customer order (customer code
                  &amp; name, SO order no, order value, rep) and its dates.
                </span>
              </label>
              <input
                id="product-csv"
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
              <p className="text-xs text-ink-5">
                In Excel or Sheets: File → Save As (or Download) → CSV. Keep the
                header row — it&rsquo;s what lets the columns be in any order.
              </p>
              <p className="text-xs text-ink-5">
                Dates can be <span className="font-mono">YYYY-MM-DD</span> or{" "}
                <span className="font-mono">30-Sep-26</span>, the way Excel
                saves them —{" "}
                <span className="font-mono">14/08</span> means two different
                days either side of the Atlantic, so it&rsquo;s refused rather
                than guessed.{" "}
                <strong className="font-semibold text-ink-3">
                  Planned for
                </strong>{" "}
                is the one date that acts: it puts the batch on the pipeline as
                Planned that day. Leave it blank to add the batch by hand later.
              </p>
            </div>
          )}

          {stage === "review" && (
            <div className="space-y-3">
              <div className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
                <p className="font-medium text-ink">{fileName}</p>
                <p className="mt-0.5 text-ink-4">
                  <strong className="text-ink">{rows.length}</strong> batch
                  {rows.length === 1 ? "" : "es"} ready to add
                  {duplicates.length > 0 &&
                    ` · ${duplicates.length} already in the catalogue`}
                  {parseErrors.length > 0 &&
                    ` · ${parseErrors.length} can't be read`}
                </p>
                {/* Which header became which field, so a column read as the
                    wrong thing is caught here rather than on the hundredth
                    row somebody opens. */}
                {read.length > 0 && (
                  <p className="mt-2 text-[11.5px] leading-relaxed text-ink-5">
                    Reading{" "}
                    {read.map((column, i) => (
                      <span key={column.label}>
                        {i > 0 && ", "}
                        <span className="font-medium text-ink-3">
                          {column.label}
                        </span>
                        {column.header.toLowerCase() !==
                          column.label.toLowerCase() && (
                          <span className="text-ink-6">
                            {" "}
                            ← {column.header}
                          </span>
                        )}
                      </span>
                    ))}
                    .
                  </p>
                )}
              </div>

              {ignored.length > 0 && (
                <ProblemList title="Columns not recognised — these are left out">
                  <li className="mb-1">
                    Rename the header to one the template uses if it should be
                    imported.
                  </li>
                  <li className="font-medium">{ignored.join(", ")}</li>
                </ProblemList>
              )}

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

              {duplicates.length > 0 && (
                <ProblemList title="Already in the catalogue — these are skipped">
                  <li className="mb-1">
                    Their existing quantities are left as they are. Edit a batch
                    on the list to change one.
                  </li>
                  <li className="font-mono">
                    {duplicates
                      .slice(0, 12)
                      .map((d) => d.batchNo)
                      .join(", ")}
                    {duplicates.length > 12 &&
                      ` …and ${duplicates.length - 12} more`}
                  </li>
                </ProblemList>
              )}

              {rows.length > 0 && (
                <ul className="max-h-40 overflow-y-auto rounded-xl border border-line text-sm">
                  {rows.slice(0, 50).map((r) => (
                    <li
                      key={r.batchNo}
                      className="flex items-center gap-3 border-b border-sunken-2 px-3.5 py-2 last:border-0"
                    >
                      <span className="shrink-0 font-mono text-[12px] font-medium text-ink">
                        {r.batchNo}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ink-2">
                        {r.name}
                        {r.customerName && (
                          <span className="text-ink-5">
                            {" "}
                            · {r.customerName}
                          </span>
                        )}
                      </span>
                      {r.plannedFor && (
                        <span
                          title={`Joins the pipeline as Planned on ${r.plannedFor}`}
                          className="shrink-0 rounded-full bg-violet-soft px-1.5 py-0.5 text-[10px] font-semibold text-violet"
                        >
                          {formatDay(r.plannedFor)}
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-[12px] text-ink-4">
                        {r.requiredQty.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </li>
                  ))}
                  {rows.length > 50 && (
                    <li className="px-3.5 py-2 text-xs text-ink-5">
                      …and {rows.length - 50} more.
                    </li>
                  )}
                </ul>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <GhostButton onClick={resetAll}>Start over</GhostButton>
                <PrimaryButton onClick={run} disabled={rows.length === 0}>
                  Import {rows.length || ""}
                </PrimaryButton>
              </div>
            </div>
          )}

          {stage === "running" && (
            <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-4 text-sm font-medium text-ink">
              <Loader2 className="size-4 animate-spin text-brand" />
              Adding {rows.length} batch{rows.length === 1 ? "" : "es"}…
            </div>
          )}

          {stage === "done" && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-2xl border border-teal-line bg-teal-soft p-4">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-teal" />
                <div className="text-sm">
                  <p className="font-semibold text-ink">
                    {added} batch{added === 1 ? "" : "es"} added
                  </p>
                  <p className="mt-0.5 text-ink-3">
                    They can be logged against in the shift log straight away.
                  </p>
                </div>
              </div>

              {fatal && (
                <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-deep">
                  {fatal}
                </p>
              )}

              {failed.length > 0 && (
                <ul className="max-h-44 overflow-y-auto rounded-xl border border-line text-sm">
                  {failed.map((r) => (
                    <li
                      key={r.batchNo}
                      className="flex items-start gap-2 border-b border-sunken-2 px-3.5 py-2 last:border-0"
                    >
                      <XCircle className="mt-0.5 size-3.5 shrink-0 text-danger-deep" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
                        {r.batchNo}
                      </span>
                      <span className="shrink-0 text-xs text-danger-deep">
                        {r.error ?? "Skipped"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <GhostButton onClick={resetAll}>Import more</GhostButton>
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
