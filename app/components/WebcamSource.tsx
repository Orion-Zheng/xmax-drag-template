"use client";

import { useEffect, useRef } from "react";

// Webcam -> a `source` track. Mounting this component asks for the camera
// (getUserMedia); unmounting it stops the camera. The page mounts it only when
// the person starts the video example on the webcam, never on page load. It
// only *produces* the track; useSourcePublisher publishes it.
//
// The self-view is mirrored, as people expect of a camera preview; the
// published track is not.
//
// contentHint = "detail": the model needs a stable resolution, but browsers
// ramp resolution at stream start and on bandwidth dips. "detail" holds it
// steady and trades framerate instead.
export function WebcamSource({
  onTrack,
  onFrame,
  onError,
}: {
  onTrack: (track: MediaStreamTrack | null) => void;
  /** The camera's frame size once known; null when it goes. */
  onFrame: (size: { w: number; h: number } | null) => void;
  /** Permission denied, no camera, camera busy, … as a readable sentence. */
  onError: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        onError("This browser cannot use a camera here (it needs https or localhost).");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: "user" },
        });
      } catch (e) {
        if (cancelled) return;
        const name = e instanceof DOMException ? e.name : "";
        onError(
          name === "NotAllowedError" || name === "SecurityError"
            ? "Camera access was denied. Allow the camera for this site, or use the example clip."
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "No camera was found. Use the example clip instead."
              : name === "NotReadableError"
                ? "The camera is in use by another application."
                : `Camera error: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const track = stream.getVideoTracks()[0];
      if (!track) {
        onError("No camera was found. Use the example clip instead.");
        return;
      }
      track.contentHint = "detail"; // hold resolution; adapt framerate
      if (videoRef.current) videoRef.current.srcObject = stream;
      const s = track.getSettings();
      onFrame(s.width && s.height ? { w: s.width, h: s.height } : null);
      onTrack(track);
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      onTrack(null);
      onFrame(null);
    };
  }, [onTrack, onFrame, onError]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
    />
  );
}
