"use client";

import { useEffect, useRef, useState } from "react";

// captureStream is widely supported on canvas but still missing from some
// DOM lib typings; declare the surface we use.
type CapturableCanvas = HTMLCanvasElement & {
  captureStream?: (frameRate?: number) => MediaStream;
};

// The model's native pacing, and the rate the drag tracks were recorded at.
const STREAM_FPS = 24;

// The streamed frame keeps the image's own aspect ratio: the model picks its
// output size from the source's aspect. The long side is capped at this (never
// upscaled), and each side is floored to a multiple of 4, which the runtime's
// video path needs to keep colour channels in order.
const LONG_SIDE = 1280;

function frameSize(w: number, h: number) {
  const s = Math.min(1, LONG_SIDE / Math.max(w, h));
  return {
    w: Math.max(4, Math.floor((w * s) / 4) * 4),
    h: Math.max(4, Math.floor((h * s) / 4) * 4),
  };
}

// Still image -> a constant `source` stream. The image is drawn to a canvas
// and captured with canvas.captureStream(24); a timer keeps repainting the
// same frame so the capture keeps emitting it. To the model this is a video of
// a motionless scene, which is the drag setup: a still subject the pointer
// brings to life. This component only *produces* the track; useSourcePublisher
// publishes it. The canvas is also the inset on the stage, so what you see is
// what the model receives.
//
// A canvas that has drawn a cross-origin image is "tainted" and captureStream()
// refuses it. That is the case wherever static files come from another domain
// (an online editor's preview, a CDN), so the image is fetched and drawn from a
// blob: URL, which is always same-origin. If the fetch itself is refused, the
// image is loaded directly with crossOrigin="anonymous", which works whenever
// the file is served with CORS headers.
export function ImageSource({
  imageUrl,
  onTrack,
  onFrame,
}: {
  imageUrl: string;
  onTrack: (track: MediaStreamTrack | null) => void;
  /** The streamed frame's size once the image is drawn; null when it goes. */
  onFrame: (size: { w: number; h: number } | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    let drawTimer: ReturnType<typeof setInterval> | null = null;
    let captured: MediaStreamTrack | null = null;
    setError(null);

    const stream = (img: HTMLImageElement) => {
      const frame = frameSize(img.naturalWidth, img.naturalHeight);
      canvas.width = frame.w;
      canvas.height = frame.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setError("Canvas 2D is unavailable in this browser.");
        return;
      }
      // Cover-crop into the frame (centre crop, no distortion); at the image's
      // own aspect the crop is only the multiple-of-4 rounding.
      const scale = Math.max(frame.w / img.naturalWidth, frame.h / img.naturalHeight);
      const cw = frame.w / scale;
      const ch = frame.h / scale;
      const cx = (img.naturalWidth - cw) / 2;
      const cy = (img.naturalHeight - ch) / 2;
      const draw = () => ctx.drawImage(img, cx, cy, cw, ch, 0, 0, frame.w, frame.h);
      draw();

      const capture = (canvas as CapturableCanvas).captureStream;
      if (!capture) {
        setError("This browser can't stream a canvas.");
        return;
      }
      let track: MediaStreamTrack | null = null;
      try {
        track = capture.call(canvas, STREAM_FPS).getVideoTracks()[0] ?? null;
      } catch (err) {
        setError(`Could not stream the image: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      if (!track) return;
      track.contentHint = "detail"; // hold resolution; adapt framerate
      captured = track;
      onFrame(frame);
      onTrack(track);
      // captureStream only emits when the canvas repaints, so keep repainting
      // at the stream rate to repeat the frame indefinitely.
      drawTimer = setInterval(draw, 1000 / STREAM_FPS);
    };

    const load = (src: string, anonymous: boolean) => {
      const img = new Image();
      if (anonymous) img.crossOrigin = "anonymous";
      img.onload = () => !cancelled && stream(img);
      img.onerror = () => !cancelled && setError("Could not load the image.");
      img.src = src;
    };

    fetch(imageUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        load(objectUrl, false);
      })
      .catch(() => !cancelled && load(imageUrl, true));

    return () => {
      cancelled = true;
      if (drawTimer) clearInterval(drawTimer);
      captured?.stop();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      onTrack(null);
      onFrame(null);
    };
  }, [imageUrl, onTrack, onFrame]);

  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-contain" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4 text-center">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
    </>
  );
}
