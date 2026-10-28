"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { XmaxX21MainVideoView } from "../lib/model";
import type { UiState } from "../lib/types";
import type { SentWindowStore } from "../lib/pointerFrames";
import { PointerOverlay } from "./PointerOverlay";
import type { ManualDrag } from "./useManualDrag";
import { ImageSource } from "./ImageSource";
import { VideoSource } from "./VideoSource";
import { WebcamSource } from "./WebcamSource";

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

/** What the model is fed: a still image, a looping clip, or the webcam.
 *  "camera-off": the webcam is the source but not on yet (it starts on Start). */
export type StageSource = {
  kind: "image" | "video" | "webcam" | "camera-off";
  url: string;
  poster: string;
};

// The stage: the model's output fills it, and the source being streamed into
// the model (the `source` track: a still image, a looping clip or the webcam)
// sits in a
// corner inset. The output carries the drag overlay: press and drag on it to
// steer (set_pointers, normalised to the output frame). The window last sent,
// by hand or replayed, is drawn on it.
//
// The output is covered while `blank` is set (the caller sets it the moment a
// Start, switch or Reset begins, and clears it once the NEW run has started).
// The WebRTC <video> keeps showing the last frame it received until a new one
// arrives, so even after `blank` clears, the cover stays until the output
// presents its next frame: the old run's last frame is never shown again.
export function Stage({
  ui,
  hint,
  source,
  blank,
  onTrack,
  onSourceFrame,
  onSourceError,
  manual,
  sentWindow,
  replayAspect,
  onDragHold,
  action,
}: {
  ui: UiState;
  /** Shown on the cover. */
  hint: string | null;
  /** The next step, shown large on the cover in place of the hint. */
  action?: ReactNode;
  source: StageSource;
  /** Hide the output until the new run is producing. */
  blank: boolean;
  onTrack: (track: MediaStreamTrack | null) => void;
  /** The streamed source's frame size, which maps the replay. */
  onSourceFrame: (size: { w: number; h: number } | null) => void;
  /** The webcam could not start (denied, missing, busy). */
  onSourceError: (message: string) => void;
  manual: ManualDrag;
  sentWindow: SentWindowStore;
  /** Aspect to place the drawn window in until the output size is known. */
  replayAspect: number | null;
  /** A manual drag starts (true) / ends (false); true back = a replay resumes. */
  onDragHold: (held: boolean) => boolean | void;
}) {
  const outputAspect =
    ui.outputWidth && ui.outputHeight ? ui.outputWidth / ui.outputHeight : null;

  const outputRef = useRef<HTMLDivElement>(null);
  const [cover, setCover] = useState(true);
  useEffect(() => {
    if (blank) {
      setCover(true);
      return;
    }
    // Reveal on the next frame the output actually presents. Without
    // requestVideoFrameCallback, reveal on the next `timeupdate` instead.
    let done = false;
    let poll: ReturnType<typeof setTimeout> | null = null;
    let cancel: (() => void) | null = null;
    const reveal = () => {
      if (done) return;
      done = true;
      setCover(false);
    };
    const attach = () => {
      if (done) return;
      const v = outputRef.current?.querySelector("video") as FrameVideo | null;
      if (!v) {
        poll = setTimeout(attach, 100);
        return;
      }
      if (v.requestVideoFrameCallback) {
        const id = v.requestVideoFrameCallback(reveal);
        cancel = () => v.cancelVideoFrameCallback?.(id);
      } else {
        v.addEventListener("timeupdate", reveal, { once: true });
        cancel = () => v.removeEventListener("timeupdate", reveal);
      }
    };
    attach();
    return () => {
      done = true;
      if (poll) clearTimeout(poll);
      cancel?.();
    };
  }, [blank]);

  const live = ui.generating && !cover;

  // The source inset takes the source's own shape: a landscape webcam shows
  // landscape, a portrait image portrait. Until a size is known, guess from
  // the kind of source.
  const [srcSize, setSrcSize] = useState<{ w: number; h: number } | null>(null);
  const handleSourceFrame = useCallback(
    (size: { w: number; h: number } | null) => {
      setSrcSize(size);
      onSourceFrame(size);
    },
    [onSourceFrame],
  );
  const srcAspect = srcSize
    ? srcSize.w / srcSize.h
    : source.kind === "webcam" || source.kind === "camera-off"
      ? 16 / 9
      : 9 / 16;
  const landscape = srcAspect >= 1;

  return (
    <section className="relative min-h-[60vh] flex-1 overflow-hidden rounded-lg border border-zinc-800 bg-black lg:min-h-0">
      <div ref={outputRef} className="absolute inset-0">
        <XmaxX21MainVideoView videoObjectFit="contain" className="absolute inset-0 h-full w-full" />
      </div>
      {cover && (
        <div className="absolute inset-0 bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={source.poster} alt="" className="absolute inset-0 h-full w-full object-contain opacity-25" />
          {hint && !action && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <p className="rounded bg-black/60 px-3 py-1.5 text-sm text-zinc-300">{hint}</p>
            </div>
          )}
        </div>
      )}
      <PointerOverlay
        outputAspect={outputAspect ?? replayAspect}
        enabled={live}
        manual={manual}
        store={sentWindow}
        onDragHold={onDragHold}
      />
      {cover && action && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-6">{action}</div>
      )}
      {live && (
        <span className="pointer-events-none absolute top-2 right-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-xs text-zinc-400">
          drag to steer
        </span>
      )}

      <div
        style={{ aspectRatio: String(srcAspect) }}
        className={`absolute right-3 bottom-12 z-10 overflow-hidden rounded-md border border-zinc-700 bg-black shadow-lg ${landscape ? "w-40 lg:w-56" : "w-24 lg:w-32"}`}
      >
        {source.kind === "video" ? (
          <VideoSource videoUrl={source.url} onTrack={onTrack} onFrame={handleSourceFrame} />
        ) : source.kind === "webcam" ? (
          <WebcamSource onTrack={onTrack} onFrame={handleSourceFrame} onError={onSourceError} />
        ) : source.kind === "camera-off" ? (
          <div className="absolute inset-0 flex items-center justify-center p-2 text-center text-[10px] text-zinc-500">
            The camera turns on when you press Start.
          </div>
        ) : (
          <ImageSource imageUrl={source.url} onTrack={onTrack} onFrame={handleSourceFrame} />
        )}
        <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-center font-mono text-[9px] leading-tight text-zinc-300">
          {source.kind === "video"
            ? "source video"
            : source.kind === "image"
              ? "source image"
              : "webcam"}
        </span>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex min-w-0 items-center gap-3 bg-gradient-to-t from-black/60 p-3 font-mono text-xs text-zinc-400">
        <span className="shrink-0">{live ? "generating" : "idle"}</span>
        {ui.outputWidth && ui.outputHeight && (
          <span className="shrink-0">
            {ui.outputWidth}×{ui.outputHeight}
          </span>
        )}
        {ui.hasReference && <span className="shrink-0">reference ✓</span>}
      </div>
    </section>
  );
}
