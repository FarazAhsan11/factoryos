"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Paperclip, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { ATTACHMENT_MAX_BYTES } from "@/app/factory/[slug]/deviations/schemas";
import { ACCEPT, MAX_FILES } from "@/components/factory/deviations/case-attachments";
import { attachmentProblem, formatBytes } from "@/lib/factory/attachment-queries";
import {
  capaFileKeys,
  capaFileUrl,
  deleteCapaFile,
  fetchCapaFiles,
  uploadCapaFile,
  type CapaFile,
  type CapaFileSection,
} from "@/lib/factory/capa-attachment-queries";
import { formatDateTime } from "@/lib/factory/dates";
import { cn } from "@/lib/utils";

/** The CAPA's files — every component reading them shares one query. */
export function useCapaFiles(factoryId: string, capaId: string) {
  return useQuery({
    queryKey: capaFileKeys.forCapa(factoryId, capaId),
    queryFn: () => fetchCapaFiles(capaId),
  });
}

/** Open a file in a new tab — the tab first, so it is not blocked as a pop-up. */
async function openFile(f: CapaFile) {
  const tab = window.open("", "_blank");
  try {
    const url = await capaFileUrl(f);
    if (tab) tab.location.href = url;
    else window.location.assign(url);
  } catch (e) {
    tab?.close();
    toast.error((e as Error).message);
  }
}

/** A file's name as a link that opens it. */
export function CapaFileLink({ file, className }: { file: CapaFile; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => openFile(file)}
      className={cn("inline-flex min-w-0 items-center gap-1.5 text-left text-brand hover:underline", className)}
    >
      <FileText className="size-3.5 shrink-0 text-ink-5" />
      <span className="truncate">{file.file_name}</span>
    </button>
  );
}

const SECTION_LABEL: Record<CapaFileSection, string> = {
  capa: "CAPA",
  action: "Action evidence",
  check: "Effectiveness check",
};

/**
 * Every file on the CAPA — its own, an action's evidence, a check's — with
 * a picker for files on the CAPA itself. Attaching is supervisor and up while
 * the CAPA is open; only the uploader removes a file, and never once the
 * CAPA is closed or the action it proves is done.
 */
export function CapaFiles({
  factoryId,
  capaId,
  userId,
  userName,
  canAttach,
}: {
  factoryId: string;
  capaId: string;
  userId: string;
  userName: string;
  canAttach: boolean;
}) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const { data: files = [], isPending } = useCapaFiles(factoryId, capaId);
  // The files, the actions and the history all sit under the CAPA's key.
  const capaKey = ["deviations", factoryId, "capas", capaId] as const;

  async function onPick(list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (input.current) input.current.value = "";
    if (picked.length === 0) return;
    if (picked.length > MAX_FILES) {
      toast.error(`Attach up to ${MAX_FILES} files at a time.`);
      return;
    }
    picked
      .map((f) => attachmentProblem(f))
      .filter((p): p is string => p !== null)
      .forEach((p) => toast.error(p));
    const ok = picked.filter((f) => attachmentProblem(f) === null);

    let done = 0;
    for (const file of ok) {
      setUploading(file.name);
      try {
        await uploadCapaFile({
          factoryId,
          capaId,
          section: "capa",
          file,
          uploadedBy: userId,
          uploadedByName: userName,
        });
        done += 1;
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    setUploading(null);
    if (done > 0) {
      await queryClient.invalidateQueries({ queryKey: capaKey });
      toast.success(done === 1 ? "File attached." : `${done} files attached.`);
    }
  }

  async function remove(f: CapaFile) {
    setRemoving(f.id);
    try {
      await deleteCapaFile(f);
      await queryClient.invalidateQueries({ queryKey: capaKey });
      toast.success(`${f.file_name} removed.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-3">
      {isPending ? (
        <Loader2 className="size-4 animate-spin text-ink-5" />
      ) : files.length === 0 ? (
        <p className="text-sm text-ink-5">No files yet.</p>
      ) : (
        <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-surface px-3.5 py-2.5"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <CapaFileLink file={f} />
                <span className="shrink-0 text-xs text-ink-5">({formatBytes(f.size_bytes)})</span>
                <span className="shrink-0 rounded-full bg-sunken-2 px-2 py-0.5 text-[0.6875rem] font-medium text-ink-4">
                  {SECTION_LABEL[f.section]}
                </span>
              </span>
              <span className="flex items-center gap-3 text-xs text-ink-4">
                {f.uploaded_by_name ?? "—"} · {formatDateTime(f.created_at)}
                {canAttach && f.uploaded_by === userId && f.section !== "action" && (
                  <button
                    type="button"
                    aria-label={`Remove ${f.file_name}`}
                    disabled={removing === f.id}
                    onClick={() => remove(f)}
                    className="grid size-7 place-items-center rounded-lg text-ink-5 transition hover:bg-sunken-2 hover:text-danger disabled:opacity-50"
                  >
                    {removing === f.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canAttach && (
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
            disabled={uploading !== null}
            onClick={() => input.current?.click()}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3.5 text-sm font-semibold text-ink-3 shadow-soft transition hover:border-brand hover:text-brand disabled:pointer-events-none disabled:opacity-60"
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
            {uploading ? `Uploading ${uploading}…` : "Attach files"}
          </button>
          <span className="text-xs text-ink-5">
            PDF, images, Word, Excel, CSV or text · up to {formatBytes(ATTACHMENT_MAX_BYTES)} each
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Files picked in a form (Mark done, Verify), held until the form is saved —
 * then uploaded with it. Refused files are named when picked.
 */
export function PickFiles({
  files,
  onChange,
  disabled,
  label = "File",
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
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
        !files.some((x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified),
    );
    if (files.length + ok.length > MAX_FILES) {
      toast.error(`Attach up to ${MAX_FILES} files here.`);
      return;
    }
    onChange([...files, ...ok]);
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-ink-3">
        {label} <span className="font-normal text-ink-5">(optional)</span>
      </p>
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${f.lastModified}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-surface py-1 pr-1 pl-2.5 text-xs text-ink-2"
            >
              <FileText className="size-3.5 shrink-0 text-ink-5" />
              <span className="truncate">{f.name}</span>
              <span className="shrink-0 text-ink-5">({formatBytes(f.size)})</span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                disabled={disabled}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="grid size-6 shrink-0 place-items-center rounded-md text-ink-5 transition hover:bg-sunken-2 hover:text-danger disabled:opacity-50"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
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
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink-3 shadow-soft transition hover:border-brand hover:text-brand disabled:pointer-events-none disabled:opacity-60"
      >
        <Paperclip className="size-3.5" />
        Attach file
      </button>
    </div>
  );
}
