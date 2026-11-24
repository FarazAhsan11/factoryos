"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TYPES,
} from "@/app/factory/[slug]/deviations/schemas";
import {
  attachmentKeys,
  attachmentProblem,
  attachmentUrl,
  deleteAttachment,
  fetchAttachments,
  formatBytes,
  uploadAttachment,
  type Attachment,
  type AttachmentSection,
} from "@/lib/factory/attachment-queries";
import { formatDateTime } from "@/lib/factory/dates";
import { ACTION_BUTTON } from "@/components/factory/deviations/deviation-fields";

export const ACCEPT = Object.values(ATTACHMENT_TYPES).join(",");
/** Per pick — a slip of the finger in a folder of four hundred photos. */
export const MAX_FILES = 10;

/**
 * The files attached to one section of a case — photos, CoAs, labels, a
 * customer's email — with a picker to add more.
 *
 * Uploads go from this browser straight to Supabase Storage, one file at a
 * time, so a 9 MB photo never passes through a Vercel function (4.5 MB cap).
 * A file that is too big or of the wrong type is refused here, by name,
 * before anything is sent; the bucket refuses it again if this is bypassed.
 */
export function CaseAttachments({
  factoryId,
  deviationId,
  section,
  userId,
  userName,
  canAttach,
  title = "Attachments",
}: {
  factoryId: string;
  deviationId: string;
  section: AttachmentSection;
  userId: string;
  userName: string;
  /** Supervisor and up, on an open case. */
  canAttach: boolean;
  /** The heading — "Attachments", or what the files are (an NCR's disposition records). */
  title?: string;
}) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const key = attachmentKeys.forCase(factoryId, deviationId);
  const { data: all = [], isPending } = useQuery({
    queryKey: key,
    queryFn: () => fetchAttachments(deviationId),
  });
  const files = all.filter((a) => a.section === section);

  async function onPick(list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (input.current) input.current.value = "";
    if (picked.length === 0) return;
    if (picked.length > MAX_FILES) {
      toast.error(`Attach up to ${MAX_FILES} files at a time.`);
      return;
    }

    // Every refusal said at once, before anything is uploaded.
    const refused = picked
      .map((f) => attachmentProblem(f))
      .filter((p): p is string => p !== null);
    refused.forEach((p) => toast.error(p));
    const ok = picked.filter((f) => attachmentProblem(f) === null);

    let done = 0;
    for (const file of ok) {
      setUploading(file.name);
      try {
        await uploadAttachment({
          factoryId,
          deviationId,
          section,
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
      await queryClient.invalidateQueries({ queryKey: key });
      toast.success(done === 1 ? "File attached." : `${done} files attached.`);
    }
  }

  async function open(a: Attachment) {
    // Opened before the await, so the browser counts it as the click's own
    // window and doesn't block it as a pop-up.
    const tab = window.open("", "_blank");
    try {
      const url = await attachmentUrl(a);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (e) {
      tab?.close();
      toast.error((e as Error).message);
    }
  }

  async function remove(a: Attachment) {
    setRemoving(a.id);
    try {
      await deleteAttachment(a);
      await queryClient.invalidateQueries({ queryKey: key });
      toast.success(`${a.file_name} removed.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold text-ink">{title}</h3>

      {isPending ? (
        <Loader2 className="size-4 animate-spin text-ink-5" />
      ) : files.length === 0 ? (
        <p className="text-sm text-ink-5">No files yet.</p>
      ) : (
        <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line">
          {files.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-surface px-3.5 py-2.5"
            >
              <button
                type="button"
                onClick={() => open(a)}
                className="flex min-w-0 items-center gap-2 text-left text-sm text-brand hover:underline"
              >
                <FileText className="size-4 shrink-0 text-ink-5" />
                <span className="truncate">{a.file_name}</span>
                <span className="shrink-0 text-xs text-ink-5">
                  ({formatBytes(a.size_bytes)})
                </span>
              </button>
              <span className="flex items-center gap-3 text-xs text-ink-4">
                {a.uploaded_by_name ?? "—"} · {formatDateTime(a.created_at)}
                {canAttach && a.uploaded_by === userId && (
                  <button
                    type="button"
                    aria-label={`Remove ${a.file_name}`}
                    disabled={removing === a.id}
                    onClick={() => remove(a)}
                    className="grid size-7 place-items-center rounded-lg text-ink-5 transition hover:bg-sunken-2 hover:text-danger disabled:opacity-50"
                  >
                    {removing === a.id ? (
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
          {/* `hidden`, not `sr-only`: an absolutely-positioned input that takes
              focus makes the browser scroll the page to wherever it ended up,
              which threw the page off-screen when the picker opened. The
              button opens it instead. */}
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
            className={ACTION_BUTTON}
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Paperclip className="size-4" />
            )}
            {uploading ? `Uploading ${uploading}…` : "Attach files"}
          </button>
          <span className="text-xs text-ink-5">
            PDF, images, Word, Excel, CSV or text · up to{" "}
            {formatBytes(ATTACHMENT_MAX_BYTES)} each, {MAX_FILES} at a time
          </span>
        </div>
      )}
    </section>
  );
}
