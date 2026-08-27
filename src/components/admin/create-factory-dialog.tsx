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
import { downscaleImage, MAX_UPLOAD_BYTES } from "@/lib/images/downscale-image";

const FIELD =
  "h-11 w-full rounded-xl border border-line bg-sunken px-3.5 text-sm text-ink outline-none transition placeholder:text-ink-5 focus:border-brand focus:bg-surface focus:ring-4 focus:ring-brand/12";
const LABEL = "text-xs font-medium text-ink-3";

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
  const [preparing, setPreparing] = useState(false);
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
    setPreparing(false);
    resetForm(EMPTY);
  }

  async function onPickLogo(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Logo must be an image file.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("That image is too large — pick one under 8 MB.");
      return;
    }

    // Shrink before it ever reaches the Server Action: the action's request
    // body is capped, and a camera-sized logo would 413 on submit.
    setPreparing(true);
    try {
      const prepared = await downscaleImage(file);
      setLogoFile(prepared);
      setLogoPreview(URL.createObjectURL(prepared));
    } finally {
      setPreparing(false);
    }
  }

  async function onSubmit(values: CreateFactoryValues) {
    setError(null);

    const formData = new FormData();
    formData.set("name", values.name);
    formData.set("description", values.description ?? "");
    formData.set("adminName", values.adminName);
    formData.set("adminEmail", values.adminEmail);
    if (logoFile) formData.set("logo", logoFile);

    let result: Awaited<ReturnType<typeof createFactory>>;
    try {
      result = await createFactory(formData);
    } catch (e) {
      // A rejected action call is a transport failure, not a validation one:
      // an oversized body (413), a dropped connection, a restarted dev server.
      // Without this the rejection escapes as an unhandled error overlay.
      setError(
        e instanceof Error && /body exceeded/i.test(e.message)
          ? "That logo is too large to upload. Try a smaller image."
          : "Could not reach the server. Check your connection and try again.",
      );
      return;
    }

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
        className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] sm:w-auto"
      >
        <Plus className="size-4" />
        Create factory
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-ink">Create a factory</DialogTitle>
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
                Logo <span className="text-ink-5">(optional)</span>
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void onPickLogo(e.target.files?.[0] ?? null)}
              />
              {logoPreview ? (
                <div className="flex items-center gap-3 rounded-xl border border-line bg-sunken p-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logoPreview}
                    alt=""
                    className="size-11 rounded-lg object-cover"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-3">
                    {logoFile?.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setLogoFile(null);
                      setLogoPreview(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="rounded-md p-1 text-ink-5 transition hover:text-ink-3"
                    aria-label="Remove logo"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={preparing}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center gap-2 rounded-xl border border-dashed border-ink-6 bg-sunken px-3.5 py-3 text-sm text-ink-4 transition hover:border-brand hover:text-brand disabled:pointer-events-none disabled:opacity-70"
                >
                  {preparing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ImagePlus className="size-4" />
                  )}
                  {preparing ? "Preparing image…" : "Upload a logo image"}
                </button>
              )}
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-deep"
              >
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-10 rounded-xl px-4 text-sm font-medium text-ink-3 transition hover:bg-sunken-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || preparing}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-70"
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
        {optional && <span className="text-ink-5"> (optional)</span>}
      </span>
      {children}
      {error && <p className="text-xs text-danger-deep">{error}</p>}
    </div>
  );
}
