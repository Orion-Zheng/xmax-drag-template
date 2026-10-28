"use client";

import { useEffect, useRef, useState } from "react";

// captureStream is widely supported but still missing from some DOM lib
// typings; declare the surface we use (plus Firefox's mozCaptureStream).
type CapturableVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

// Video file -> a `source` track. The clip plays muted and looping in a
// <video>, and its frames are captured with captureStream(); this component
// only *produces* the track (useSourcePublisher publishes it). The element is
// also the inset on the stage, so what you see is what the model receives.
//
// captureStream() refuses a clip the browser considers cross-origin, which is
// the case wherever static files come from another domain (an online editor's
// preview, a CDN). So the clip is fetched and played from a blob: URL, which is
// always same-origin. If the fetch itself is refused, the clip is played
// directly with crossOrigin="anonymous", which works whenever the file is
// served with CORS headers.
export function VideoSource({
  videoUrl,
  onTrack,
  onFrame,
}: {
  videoUrl: string;
  onTrack: (track: MediaStreamTrack | null) => void;
  /** The clip's frame size once known; null when it goes. */
  onFrame: (size: { w: number; h: number } | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<{ url: string; anonymous: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve a same-origin URL for the clip.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setSrc(null);
    setError(null);
    fetch(videoUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc({ url: objectUrl, anonymous: false });
      })
      .catch(() => !cancelled && setSrc({ url: videoUrl, anonymous: true }));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [videoUrl]);

  // Capture the clip's frames into a track once its metadata is loaded.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    let cancelled = false;
    let captured: MediaStreamTrack | null = null;

    const startCapture = () => {
      if (cancelled) return;
      const cap = v as CapturableVideo;
      const capture = cap.captureStream ?? cap.mozCaptureStream;
      if (!capture) {
        setError("This browser can't stream a video file.");
        return;
      }
      let track: MediaStreamTrack | null = null;
      try {
        track = capture.call(v).getVideoTracks()[0] ?? null;
      } catch (err) {
        setError(`Could not stream the clip: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      if (!track) return;
      track.contentHint = "detail"; // hold resolution; adapt framerate
      captured = track;
      onFrame(v.videoWidth && v.videoHeight ? { w: v.videoWidth, h: v.videoHeight } : null);
      onTrack(track);
    };

    if (v.readyState >= 1 /* HAVE_METADATA */) startCapture();
    else v.addEventListener("loadedmetadata", startCapture, { once: true });
    void v.play().catch(() => {});

    return () => {
      cancelled = true;
      v.removeEventListener("loadedmetadata", startCapture);
      captured?.stop();
      onTrack(null);
      onFrame(null);
    };
  }, [src, onTrack, onFrame]);

  return (
    <>
      {src && (
        <video
          ref={videoRef}
          key={src.url}
          src={src.url}
          crossOrigin={src.anonymous ? "anonymous" : undefined}
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-contain"
        />
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4 text-center">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
    </>
  );
}
