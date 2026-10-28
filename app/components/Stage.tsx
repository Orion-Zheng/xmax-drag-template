"use client";

import { XmaxX21MainVideoView } from "../lib/model";
import type { UiState } from "../lib/types";
import type { SentWindowStore } from "../lib/pointerFrames";
import { PointerOverlay } from "./PointerOverlay";
import type { ManualDrag } from "./useManualDrag";
import { VideoSource } from "./VideoSource";

// The stage: the model's output fills it, and the clip being streamed into the
// model (the `source` track) plays in a corner inset. The output carries the
// drag overlay: press and drag on it to steer the character (set_pointers,
// normalised to the output frame). The window last sent, by hand or replayed,
// is drawn on it.
export function Stage({
  ui,
  hint,
  videoUrl,
  cleared,
  onTrack,
  onVideo,
  manual,
  sentWindow,
  replayAspect,
  onDragHold,
}: {
  ui: UiState;
  /** Shown over the output while it is not generating. */
  hint: string | null;
  /** The source clip; null before an example is picked. */
  videoUrl: string | null;
  // After a reset the WebRTC <video> would freeze on the last received frame
  // (the model emits nothing new); cover it until generation runs again.
  cleared: boolean;
  onTrack: (track: MediaStreamTrack | null) => void;
  /** The source clip's <video> element, which times the replay. */
  onVideo: (video: HTMLVideoElement | null) => void;
  manual: ManualDrag;
  sentWindow: SentWindowStore;
  /** Aspect to place the drawn window in until the output size is known. */
  replayAspect: number | null;
  /** A manual drag starts (true) / ends (false); true back = a replay resumes. */
  onDragHold: (held: boolean) => boolean | void;
}) {
  const outputAspect =
    ui.outputWidth && ui.outputHeight ? ui.outputWidth / ui.outputHeight : null;

  return (
    <section className="relative min-h-[60vh] flex-1 overflow-hidden rounded-lg border border-zinc-800 bg-black lg:min-h-0">
      <XmaxX21MainVideoView videoObjectFit="contain" className="absolute inset-0 h-full w-full" />
      {cleared && <div className="absolute inset-0 bg-black" />}
      <PointerOverlay
        outputAspect={outputAspect ?? replayAspect}
        enabled={ui.generating}
        manual={manual}
        store={sentWindow}
        onDragHold={onDragHold}
      />
      {!ui.generating && hint && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="text-sm text-zinc-500">{hint}</p>
        </div>
      )}
      {ui.generating && (
        <span className="pointer-events-none absolute top-2 right-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-xs text-zinc-400">
          drag to steer
        </span>
      )}

      {videoUrl && (
        <div className="absolute right-3 bottom-12 z-10 aspect-[9/16] w-24 overflow-hidden rounded-md border border-zinc-700 bg-black shadow-lg lg:w-32">
          <VideoSource videoUrl={videoUrl} onTrack={onTrack} onVideo={onVideo} />
          <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-center font-mono text-[9px] leading-tight text-zinc-300">
            source clip
          </span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex min-w-0 items-center gap-3 bg-gradient-to-t from-black/60 p-3 font-mono text-xs text-zinc-400">
        <span className="shrink-0">{ui.generating ? "generating" : "idle"}</span>
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
