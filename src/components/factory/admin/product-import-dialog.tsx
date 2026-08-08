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
import {
  PRODUCT_CSV_TEMPLATE,
  parseProductCsv,
  splitExisting,
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
  const [results, setResults] = useState<ProductImportResult[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function resetAll() {
    setStage("input");
    setFileName("");
    setRows([]);
    setDuplicates([]);
    setParseErrors([]);
    setResults([]);
    setFatal(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  /** Parse → split off what the catalogue already has → show the review. */
  function review(text: string, name: string) {
    const parsed = parseProductCsv(text);
    const { fresh, duplicates: dupes } = splitExisting(
      parsed.rows,
      existingBatchNos
    );
    setFileName(name);
    setRows(fresh);
    setDuplicates(dupes);
    setParseErrors(parsed.errors);
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
          : "Import stopped unexpectedly."
      );
    }

    setStage("done");
    onImported();
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(
      new Blob([PRODUCT_CSV_TEMPLATE], { type: "text/csv" })
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
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-[#E6EAF1] bg-white px-3 text-sm font-medium text-[#475569] transition hover:bg-[#F8FAFC]"
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
            <DialogTitle className="text-[#0F1B34]">Import products</DialogTitle>
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
                className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-[#CBD5E1] bg-[#FBFCFE] px-4 py-10 text-center transition hover:border-[#2563EB] hover:bg-[#F5F8FF]"
              >
                <FileUp className="size-6 text-[#94A3B8]" />
                <span className="text-sm font-medium text-[#0F1B34]">
                  Choose a CSV file
                </span>
                <span className="text-xs text-[#94A3B8]">
                  Columns: batch, code, product name, work order, required qty
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
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#2563EB] transition hover:underline"
              >
                <Download className="size-3.5" />
                Download a template
              </button>
              <p className="text-xs text-[#94A3B8]">
                In Excel or Sheets: File → Save As (or Download) → CSV. Keep the
                header row — it&rsquo;s what lets the columns be in any order.
              </p>
            </div>
          )}

          {stage === "review" && (
            <div className="space-y-3">
              <div className="rounded-xl border border-[#E6EAF1] bg-[#FBFCFE] px-4 py-3 text-sm">
                <p className="font-medium text-[#0F1B34]">{fileName}</p>
                <p className="mt-0.5 text-[#64748B]">
                  <strong className="text-[#0F1B34]">{rows.length}</strong> batch
                  {rows.length === 1 ? "" : "es"} ready to add
                  {duplicates.length > 0 &&
                    ` · ${duplicates.length} already in the catalogue`}
                  {parseErrors.length > 0 &&
                    ` · ${parseErrors.length} can't be read`}
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
                <ul className="max-h-40 overflow-y-auto rounded-xl border border-[#E6EAF1] text-sm">
                  {rows.slice(0, 50).map((r) => (
                    <li
                      key={r.batchNo}
                      className="flex items-center gap-3 border-b border-[#F1F5F9] px-3.5 py-2 last:border-0"
                    >
                      <span className="shrink-0 font-mono text-[12px] font-medium text-[#0F1B34]">
                        {r.batchNo}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[#334155]">
                        {r.name}
                      </span>
                      <span className="shrink-0 font-mono text-[12px] text-[#64748B]">
                        {r.requiredQty.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </li>
                  ))}
                  {rows.length > 50 && (
                    <li className="px-3.5 py-2 text-xs text-[#94A3B8]">
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
            <div className="flex items-center gap-2 rounded-2xl border border-[#E6EAF1] bg-[#FBFCFE] p-4 text-sm font-medium text-[#0F1B34]">
              <Loader2 className="size-4 animate-spin text-[#2563EB]" />
              Adding {rows.length} batch{rows.length === 1 ? "" : "es"}…
            </div>
          )}

          {stage === "done" && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-2xl border border-[#BBF7D0] bg-[#F0FDF4] p-4">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[#16A34A]" />
                <div className="text-sm">
                  <p className="font-semibold text-[#0F1B34]">
                    {added} batch{added === 1 ? "" : "es"} added
                  </p>
                  <p className="mt-0.5 text-[#475569]">
                    They can be logged against in the shift log straight away.
                  </p>
                </div>
              </div>

              {fatal && (
                <p className="rounded-xl bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
                  {fatal}
                </p>
              )}

              {failed.length > 0 && (
                <ul className="max-h-44 overflow-y-auto rounded-xl border border-[#E6EAF1] text-sm">
                  {failed.map((r) => (
                    <li
                      key={r.batchNo}
                      className="flex items-start gap-2 border-b border-[#F1F5F9] px-3.5 py-2 last:border-0"
                    >
                      <XCircle className="mt-0.5 size-3.5 shrink-0 text-[#B91C1C]" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[#0F1B34]">
                        {r.batchNo}
                      </span>
                      <span className="shrink-0 text-xs text-[#B91C1C]">
                        {r.error ?? "Skipped"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <GhostButton onClick={resetAll}>Import more</GhostButton>
                <PrimaryButton onClick={() => setOpen(false)}>Done</PrimaryButton>
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
    <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-xs text-[#92400E]">
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
      className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
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
      className="h-10 rounded-xl px-4 text-sm font-medium text-[#475569] transition hover:bg-[#F1F5F9]"
    >
      {children}
    </button>
  );
}
