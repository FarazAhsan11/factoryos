"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ImagePlus, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { createFactory } from "@/app/admin/actions";
import {
  createFactorySchema,
  type CreateFactoryValues,
} from "@/app/admin/schemas";
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

const EMPTY: CreateFactoryValues = {
  name: "",
  description: "",
  adminName: "",
  adminEmail: "",
};

export function CreateFactoryDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The logo is a File, so it stays outside the form values and rides along on
  // the FormData the Server Action needs for the upload.
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    reset: resetForm,
    formState: { errors, isSubmitting },
  } = useForm<CreateFactoryValues>({
    resolver: zodResolver(createFactorySchema),
    defaultValues: EMPTY,
  });

  function reset() {
    setError(null);
    setLogoFile(null);
    setLogoPreview(null);
    resetForm(EMPTY);
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

  async function onSubmit(values: CreateFactoryValues) {
    setError(null);

    const formData = new FormData();
    formData.set("name", values.name);
    formData.set("description", values.description ?? "");
    formData.set("adminName", values.adminName);
    formData.set("adminEmail", values.adminEmail);
    if (logoFile) formData.set("logo", logoFile);

    const result = await createFactory(formData);

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

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Field label="Factory name" error={errors.name?.message}>
              <input
                id="cf-name"
                placeholder="AcelPharma"
                aria-invalid={Boolean(errors.name)}
                className={FIELD}
                {...register("name")}
              />
            </Field>

            <Field
              label="Short info"
              optional
              error={errors.description?.message}
            >
              <textarea
                id="cf-desc"
                rows={2}
                placeholder="What this factory makes, where it is…"
                className={`${FIELD} h-auto resize-none py-2.5`}
                {...register("description")}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Admin name" error={errors.adminName?.message}>
                <input
                  id="cf-admin-name"
                  placeholder="Thian Mang"
                  aria-invalid={Boolean(errors.adminName)}
                  className={FIELD}
                  {...register("adminName")}
                />
              </Field>

              <Field label="Admin email" error={errors.adminEmail?.message}>
                <input
                  id="cf-email"
                  type="email"
                  placeholder="admin@acelpharma.com"
                  aria-invalid={Boolean(errors.adminEmail)}
                  className={FIELD}
                  {...register("adminEmail")}
                />
              </Field>
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
                disabled={isSubmitting}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-70"
              >
                {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                {isSubmitting ? "Creating…" : "Create factory"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({
  label,
  error,
  optional,
  children,
}: {
  label: string;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className={LABEL}>
        {label}
        {optional && <span className="text-[#94A3B8]"> (optional)</span>}
      </span>
      {children}
      {error && <p className="text-xs text-[#B91C1C]">{error}</p>}
    </div>
  );
}
