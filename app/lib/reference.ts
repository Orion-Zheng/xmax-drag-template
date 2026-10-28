"use client";

import { useCallback, useState } from "react";
import { useXmaxX21 } from "./model";

// The runtime feeds the reference image to the model as a driving video, and
// its GStreamer pipeline scrambles the color channels when a frame's width or
// height isn't a multiple of 4. Floor each side to a multiple of 4 and
// center-crop before upload (at most 3 px per side). Best-effort: any failure
// returns the original file so the upload still goes through.
async function toMod4(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("decode failed"));
      image.src = url;
    });
    const w = Math.max(4, Math.floor(img.naturalWidth / 4) * 4);
    const h = Math.max(4, Math.floor(img.naturalHeight / 4) * 4);
    if (w === img.naturalWidth && h === img.naturalHeight) return file;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, (img.naturalWidth - w) / 2, (img.naturalHeight - h) / 2, w, h, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ?? file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A static asset as a File, for the same upload path as a picked file. */
export async function fileFromUrl(url: string): Promise<File> {
  const blob = await (await fetch(url)).blob();
  return new File([blob], url.split("/").pop() || "reference.jpg", {
    type: blob.type || "image/jpeg",
  });
}

// Reference image: the SDK's presigned upload (uploadFile), then
// set_reference_image with the returned FileRef. The awaited call answers with
// `reference_image_accepted`, or undefined when the model refused the file
// (the reason then lands on the SDK's `lastError`).
export function useReferenceUpload() {
  const { uploadFile, setReferenceImage } = useXmaxX21();
  const [busy, setBusy] = useState(false);

  const apply = useCallback(
    async (file: File): Promise<boolean> => {
      setBusy(true);
      try {
        const ref = await uploadFile(await toMod4(file), { name: file.name });
        const ack = await setReferenceImage({ reference_image: ref });
        return !!ack;
      } finally {
        setBusy(false);
      }
    },
    [uploadFile, setReferenceImage],
  );

  return { apply, busy };
}
