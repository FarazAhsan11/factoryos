import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TYPES,
} from "@/app/factory/[slug]/deviations/schemas";
import { createClient } from "@/lib/supabase/client";

/**
 * Files attached to a case (migration 0064).
 *
 * Uploaded **from the browser straight to Supabase Storage** — never through
 * a Server Action or route handler, which on Vercel cap a request body at
 * 4.5 MB. The bucket (`case-files`, private) enforces the size limit and the
 * type list itself; the checks here only refuse early, in plain words.
 *
 * Two writes per file: the object, then its row. If the row is refused the
 * object is removed again, so Storage never holds a file the case doesn't
 * list.
 */

export type AttachmentSection =
  | "details"
  | "assessment"
  | "investigation"
  | "actions"
  | "closeout";

export interface Attachment {
  id: string;
  deviation_id: string;
  section: AttachmentSection;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
}

const BUCKET = "case-files";

/** Under the deviations prefix, so any Quality save refreshes it too. */
export const attachmentKeys = {
  forCase: (factoryId: string, deviationId: string) =>
    ["deviations", factoryId, "attachments", deviationId] as const,
};

export async function fetchAttachments(
  deviationId: string,
): Promise<Attachment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("deviation_attachments")
    .select(
      "id, deviation_id, section, storage_path, file_name, mime_type, size_bytes, uploaded_by, uploaded_by_name, created_at",
    )
    .eq("deviation_id", deviationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Attachment[];
}

/** "4.2 MB", "820 KB". */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * Why a file can't be attached, or null. Types are checked by MIME type, and
 * by extension when the browser reports none (it often doesn't for .heic or
 * .csv on Windows).
 */
export function attachmentProblem(file: File): string | null {
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return `${file.name} is ${formatBytes(file.size)} — the limit is ${formatBytes(ATTACHMENT_MAX_BYTES)}.`;
  }
  if (!mimeOf(file)) {
    return `${file.name} isn't a type that can be attached — use PDF, an image (JPG, PNG, WebP, HEIC), Word, Excel, CSV or text.`;
  }
  return null;
}

/** The MIME type the bucket will see, or null if it is not allowed. */
function mimeOf(file: File): string | null {
  if (file.type && ATTACHMENT_TYPES[file.type]) return file.type;
  const ext = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  if (!ext) return null;
  const found = Object.entries(ATTACHMENT_TYPES).find(([, exts]) =>
    exts.split(",").includes(ext),
  );
  return found ? found[0] : null;
}

/** A name safe for a Storage key: letters, digits, dot, dash, underscore. */
function safeName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(-120);
  return cleaned || "file";
}

export async function uploadAttachment({
  factoryId,
  deviationId,
  section,
  file,
  uploadedBy,
  uploadedByName,
}: {
  factoryId: string;
  deviationId: string;
  section: AttachmentSection;
  file: File;
  uploadedBy: string;
  uploadedByName: string;
}): Promise<void> {
  const problem = attachmentProblem(file);
  if (problem) throw new Error(problem);
  const contentType = mimeOf(file)!;

  const supabase = createClient();
  const path = `${factoryId}/${deviationId}/${crypto.randomUUID()}-${safeName(file.name)}`;

  const { error: upload } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType, upsert: false });
  if (upload) throw new Error(`${file.name}: ${upload.message}`);

  const { error: row } = await supabase.from("deviation_attachments").insert({
    factory_id: factoryId,
    deviation_id: deviationId,
    section,
    storage_path: path,
    file_name: file.name,
    mime_type: contentType,
    size_bytes: file.size,
    uploaded_by: uploadedBy,
    uploaded_by_name: uploadedByName.trim() || null,
  });
  if (row) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(`${file.name}: ${row.message}`);
  }
}

/** The row first: once it is gone the case no longer lists the file. */
export async function deleteAttachment(a: Attachment): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("deviation_attachments")
    .delete()
    .eq("id", a.id)
    .select("id");
  if (error) throw new Error(error.message);
  // RLS refuses a delete by deleting nothing, not by erroring.
  if (!data || data.length === 0) {
    throw new Error(
      "Only the person who attached a file can remove it, while the case is open.",
    );
  }
  await supabase.storage.from(BUCKET).remove([a.storage_path]);
}

/** A link that works for a minute — the bucket is private. */
export async function attachmentUrl(a: Attachment): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(a.storage_path, 60);
  if (error || !data) throw new Error(error?.message ?? "Could not open the file.");
  return data.signedUrl;
}
