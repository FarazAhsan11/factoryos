"use client";

import { useRef } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { toast } from "sonner";

import { ATTACHMENT_MAX_BYTES } from "@/app/factory/[slug]/deviations/schemas";
import { ACCEPT, MAX_FILES } from "@/components/factory/deviations/case-attachments";
import { attachmentProblem, formatBytes } from "@/lib/factory/attachment-queries";

/**
 * Files picked on the raise page, held in the browser until the case exists.
 *
 * An attachment is stored under its case's id, which a deviation doesn't have
 * until it is raised — so the raise page keeps the picked files here and
 * uploads them (to Details) straight after the insert. A file that is too big
 * or of the wrong type is refused when picked, as `CaseAttachments` does.
 */
export function PendingAttachments({
  files,
  onChange,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);

  function onPick(list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (input.current) input.current.value = "";
    if (picked.length === 0) return;

    picked
      .map((f) => attachmentProblem(f))
      .filter((p): p is string => p !== null)
      .forEach((p) => toast.error(p));
    const ok = picked.filter(
      (f) =>
        attachmentProblem(f) === null &&
        // The same file picked twice is attached once.
        !files.some(
          (x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified,
        ),
    );

    if (files.length + ok.length > MAX_FILES) {
      toast.error(`Attach up to ${MAX_FILES} files when raising — add more on the case.`);
      return;
    }
    onChange([...files, ...ok]);
  }

  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold text-ink">Attachments</h3>

      {files.length > 0 && (
        <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${f.lastModified}`}
              className="flex items-center justify-between gap-4 bg-surface px-3.5 py-2.5"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm text-ink-2">
                <FileText className="size-4 shrink-0 text-ink-5" />
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 text-xs text-ink-5">({formatBytes(f.size)})</span>
              </span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                disabled={disabled}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-5 transition hover:bg-sunken-2 hover:text-danger disabled:opacity-50"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {/* `hidden`, not `sr-only` — see CaseAttachments. */}
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          tabIndex={-1}
          onChange={(e) => onPick(e.target.files)}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => input.current?.click()}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3.5 text-sm font-semibold text-ink-3 shadow-soft transition hover:border-brand hover:text-brand disabled:pointer-events-none disabled:opacity-60"
        >
          <Paperclip className="size-4" />
          Attach files
        </button>
        <span className="text-xs text-ink-5">
          Optional · PDF, images, Word, Excel, CSV or text · up to{" "}
          {formatBytes(ATTACHMENT_MAX_BYTES)} each, {MAX_FILES} in all · uploaded
          when the deviation is raised
        </span>
      </div>
    </section>
  );
}
