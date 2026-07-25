"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { createFactory } from "@/app/admin/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const FIELD =
  "h-11 w-full rounded-xl border border-[#E6EAF1] bg-[#FBFCFE] px-3.5 text-sm text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:bg-white focus:ring-4 focus:ring-[#2563EB]/12";
const LABEL = "text-xs font-medium text-[#475569]";

export function CreateFactoryDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setError(null);
    setLogoFile(null);
    setLogoPreview(null);
  }

  function onPickLogo(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Logo must be an image file.");
      return;
    }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const formData = new FormData(event.currentTarget);
    if (logoFile) formData.set("logo", logoFile);
    else formData.delete("logo");

    const result = await createFactory(formData);
    setPending(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    if (result.warning) toast.warning(result.warning);
    else toast.success("Factory created — invite sent to the admin.");

    setOpen(false);
    reset();
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06] sm:w-auto"
      >
        <Plus className="size-4" />
        Create factory
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#0F1B34]">
              Create a factory
            </DialogTitle>
            <DialogDescription>
              Add a new tenant and invite its first admin by email.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="cf-name" className={LABEL}>
                Factory name
              </label>
              <input
                id="cf-name"
                name="name"
                required
                placeholder="AcelPharma"
                className={FIELD}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cf-desc" className={LABEL}>
                Short info <span className="text-[#94A3B8]">(optional)</span>
              </label>
              <textarea
                id="cf-desc"
                name="description"
                rows={2}
                placeholder="What this factory makes, where it is…"
                className={`${FIELD} h-auto resize-none py-2.5`}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cf-email" className={LABEL}>
                Admin email
              </label>
              <input
                id="cf-email"
                name="adminEmail"
                type="email"
                required
                placeholder="admin@acelpharma.com"
                className={FIELD}
              />
            </div>

            <div className="space-y-1.5">
              <span className={LABEL}>
                Logo <span className="text-[#94A3B8]">(optional)</span>
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onPickLogo(e.target.files?.[0] ?? null)}
              />
              {logoPreview ? (
                <div className="flex items-center gap-3 rounded-xl border border-[#E6EAF1] bg-[#FBFCFE] p-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logoPreview}
                    alt=""
                    className="size-11 rounded-lg object-cover"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-[#475569]">
                    {logoFile?.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setLogoFile(null);
                      setLogoPreview(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="rounded-md p-1 text-[#94A3B8] transition hover:text-[#475569]"
                    aria-label="Remove logo"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center gap-2 rounded-xl border border-dashed border-[#CBD5E1] bg-[#FBFCFE] px-3.5 py-3 text-sm text-[#64748B] transition hover:border-[#2563EB] hover:text-[#2563EB]"
                >
                  <ImagePlus className="size-4" />
                  Upload a logo image
                </button>
              )}
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]"
              >
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-10 rounded-xl px-4 text-sm font-medium text-[#475569] transition hover:bg-[#F1F5F9]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-70"
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                {pending ? "Creating…" : "Create factory"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
