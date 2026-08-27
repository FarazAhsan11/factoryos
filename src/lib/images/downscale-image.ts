/**
 * Browser-side image shrinking, used before any file rides along on a Server
 * Action's FormData.
 *
 * Server Actions have a hard body limit (1 MB by default, see next.config.ts),
 * and a phone camera shot or an exported PNG blows straight past it — the POST
 * comes back 413 and the browser reports the useless "TypeError: Failed to
 * fetch". Nothing we display a logo in is bigger than ~96px, so re-encoding to
 * a few tens of kilobytes costs us no visible quality and takes the upload out
 * of the danger zone entirely.
 */

export interface DownscaleOptions {
  /** Longest edge of the result, in pixels. */
  maxEdge?: number;
  /** WebP quality, 0–1. */
  quality?: number;
}

/** Anything above this is rejected before we even try to decode it. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Returns a re-encoded, size-capped copy of `file`.
 *
 * SVGs are passed through untouched: they are already tiny, and rasterising
 * one would throw away the only reason to use it. If decoding or encoding
 * fails for any reason we hand back the original — a slightly-too-big upload
 * that the server may still accept beats refusing to attach a logo at all.
 */
export async function downscaleImage(
  file: File,
  { maxEdge = 512, quality = 0.9 }: DownscaleOptions = {},
): Promise<File> {
  if (file.type === "image/svg+xml") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));

    // Already small enough and cheap to store — don't re-encode for nothing.
    if (scale === 1 && file.size <= 256 * 1024) {
      bitmap.close();
      return file;
    }

    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    // WebP keeps the alpha channel, which matters for logos on white cards.
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality),
    );
    if (!blob) return file;

    const name = file.name.replace(/\.[^.]+$/, "") || "logo";
    return new File([blob], `${name}.webp`, {
      type: "image/webp",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}
