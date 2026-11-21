import {
  BUCKET,
  attachmentProblem,
  mimeOf,
  safeName,
} from "@/lib/factory/attachment-queries";
import { createClient } from "@/lib/supabase/client";

/**
 * Files attached to a CAPA (migration 0075) — on the CAPA itself, as the
 * evidence of an action marked done, or with an effectiveness check.
 *
 * The same private `case-files` bucket as a case's files, under
 * `{factory}/capa/{capa}/…`, uploaded from the browser straight to Storage
 * (never through a Vercel function and its 4.5 MB cap). The object first,
 * then its row; a refused row removes the object again.
 */

export type CapaFileSection = "capa" | "action" | "check";

export interface CapaFile {
  id: string;
  capa_id: string;
  section: CapaFileSection;
  action_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
}

/** Under the deviations prefix, so any Quality save refreshes it too. */
export const capaFileKeys = {
  forCapa: (factoryId: string, capaId: string) =>
    ["deviations", factoryId, "capas", capaId, "files"] as const,
};

export async function fetchCapaFiles(capaId: string): Promise<CapaFile[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("capa_attachments")
    .select(
      "id, capa_id, section, action_id, storage_path, file_name, mime_type, size_bytes, uploaded_by, uploaded_by_name, created_at",
    )
    .eq("capa_id", capaId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CapaFile[];
}

/** Upload one file and record it; returns the row's id. */
export async function uploadCapaFile({
  factoryId,
  capaId,
  section,
  actionId,
  file,
  uploadedBy,
  uploadedByName,
}: {
  factoryId: string;
  capaId: string;
  section: CapaFileSection;
  actionId?: string | null;
  file: File;
  uploadedBy: string;
  uploadedByName: string;
}): Promise<CapaFile> {
  const problem = attachmentProblem(file);
  if (problem) throw new Error(problem);
  const contentType = mimeOf(file)!;

  const supabase = createClient();
  const path = `${factoryId}/capa/${capaId}/${crypto.randomUUID()}-${safeName(file.name)}`;

  const { error: upload } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType, upsert: false });
  if (upload) throw new Error(`${file.name}: ${upload.message}`);

  const { data, error: row } = await supabase
    .from("capa_attachments")
    .insert({
      factory_id: factoryId,
      capa_id: capaId,
      section,
      action_id: actionId ?? null,
      storage_path: path,
      file_name: file.name,
      mime_type: contentType,
      size_bytes: file.size,
      uploaded_by: uploadedBy,
      uploaded_by_name: uploadedByName.trim() || null,
    })
    .select("id, capa_id, section, action_id, storage_path, file_name, mime_type, size_bytes, uploaded_by, uploaded_by_name, created_at")
    .single();
  if (row || !data) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(`${file.name}: ${row?.message ?? "could not be recorded."}`);
  }
  return data as CapaFile;
}

/**
 * Upload several files in turn. If one fails, the ones already uploaded in
 * this call are removed again, so a form that fails leaves nothing behind.
 */
export async function uploadCapaFiles(
  files: File[],
  base: Omit<Parameters<typeof uploadCapaFile>[0], "file">,
): Promise<CapaFile[]> {
  const done: CapaFile[] = [];
  try {
    for (const file of files) done.push(await uploadCapaFile({ ...base, file }));
  } catch (e) {
    await Promise.all(done.map((f) => deleteCapaFile(f).catch(() => {})));
    throw e;
  }
  return done;
}

/** The row first: once it is gone the CAPA no longer lists the file. */
export async function deleteCapaFile(f: CapaFile): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("capa_attachments")
    .delete()
    .eq("id", f.id)
    .select("id");
  if (error) throw new Error(error.message);
  // RLS refuses a delete by deleting nothing, not by erroring.
  if (!data || data.length === 0) {
    throw new Error(
      "Only the person who attached a file can remove it, while the CAPA is open — and not the evidence of an action already done.",
    );
  }
  await supabase.storage.from(BUCKET).remove([f.storage_path]);
}

/** A link that works for a minute — the bucket is private. */
export async function capaFileUrl(f: CapaFile): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(f.storage_path, 60);
  if (error || !data) throw new Error(error?.message ?? "Could not open the file.");
  return data.signedUrl;
}
