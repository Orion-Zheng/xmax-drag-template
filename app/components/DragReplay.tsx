"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useXmaxX21, useXmaxX21StateUpdate } from "../lib/model";
import { media, type DragSpec, type DragTrack } from "../lib/examples";
import {
  EMPTY_WINDOW,
  describeWindow,
  framesPayload,
  windowIndices,
  type DragPoint,
  type PointerWindow,
  type SentWindowStore,
} from "../lib/pointerFrames";
import { Button, Panel, cn } from "./ui";
import type { ManualDrag } from "./useManualDrag";

// Replays a drag example's recorded pointer trajectory against its source
// clip.
//
// The track holds one list of points per source frame. The frame index is read
// from the playing clip itself (frame = floor(currentTime * fps)), so the
// points stay locked to the frames the model is receiving and wrap around when
// the clip loops. Each time the frame f changes, the points of frames f-3..f
// are sent as one window,
// `set_pointers({ frames: [pts(f-3), pts(f-2), pts(f-1), pts(f)] })`
// (normalised 0..1, empty = no drag on that frame; see lib/pointerFrames), so
// whenever the model starts a chunk it has the four latest per-frame
// positions.
//
// A manual drag on the output takes over while it is held (`hold(true)`): the
// replay keeps tracking the clip but sends nothing; on release the current
// window is sent again.
export type ReplayPhase = "off" | "running" | "held" | "failed";

type Size = { w: number; h: number };

// Where a point of a `from` frame lands in a `to` frame when `from` is fitted
// into `to` the way the server fits a source frame into the output: aspect
// within 20 % of `to` -> scale to cover (ceil) and centre-crop (round half to
// even); otherwise scale to fit (round) and centre on black. Pixel centres,
// x = col / (W-1). Normalised in and out.
function fitPoints(pts: DragPoint[], from: Size, to: Size): DragPoint[] {
  if (from.w === to.w && from.h === to.h) return pts;
  const roundHalfEven = (v: number) => {
    const r = Math.round(v);
    return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
  };
  const target = to.w / to.h;
  let rw: number, rh: number, left: number, top: number;
  if (Math.abs(from.w / from.h - target) / target <= 0.2) {
    const s = Math.max(to.h / from.h, to.w / from.w);
    rh = Math.ceil(from.h * s);
    rw = Math.ceil(from.w * s);
    top = roundHalfEven((rh - to.h) / 2);
    left = roundHalfEven((rw - to.w) / 2);
  } else {
    const s = Math.min(to.h / from.h, to.w / from.w);
    rh = Math.max(1, Math.round(from.h * s));
    rw = Math.max(1, Math.round(from.w * s));
    top = -Math.floor((to.h - rh) / 2);
    left = -Math.floor((to.w - rw) / 2);
  }
  const sx = rw / from.w;
  const sy = rh / from.h;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return pts.map(([x, y]) => [
    clamp(((x * (from.w - 1) + 0.5) * sx - 0.5 - left) / (to.w - 1)),
    clamp(((y * (from.h - 1) + 0.5) * sy - 0.5 - top) / (to.h - 1)),
  ]);
}

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export function useDragReplay(drag: DragSpec | null, store: SentWindowStore) {
  const { setPointers } = useXmaxX21();
  const [track, setTrack] = useState<DragTrack | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [phase, setPhaseState] = useState<ReplayPhase>("off");
  const phaseRef = useRef<ReplayPhase>("off");
  const setPhase = (p: ReplayPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  const [failure, setFailure] = useState<string | null>(null);
  const [frame, setFrame] = useState<number | null>(null);

  const videoRef = useRef<FrameVideo | null>(null);
  const trackRef = useRef<DragTrack | null>(null);
  // The spec the loaded track belongs to, so a caller can wait for the right one.
  const loadedForRef = useRef<DragSpec | null>(null);
  const lastFrameRef = useRef(-1);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setTrack(null);
    trackRef.current = null;
    loadedForRef.current = null;
    setTrackError(null);
    if (!drag) return;
    let cancelled = false;
    fetch(media(drag.track))
      .then((r) => {
        if (!r.ok) throw new Error(`track.json: HTTP ${r.status}`);
        return r.json() as Promise<DragTrack>;
      })
      .then((t) => {
        if (cancelled) return;
        trackRef.current = t;
        loadedForRef.current = drag;
        setTrack(t);
      })
      .catch((err: unknown) => !cancelled && setTrackError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [drag]);

  const setVideo = useCallback((v: HTMLVideoElement | null) => {
    videoRef.current = v as FrameVideo | null;
  }, []);

  // The track is in the source clip's frame; set_pointers takes the output
  // frame. A point goes through the same fit the server applies to the source
  // (fitPoints). The output size arrives in state_update once the run has
  // started; until then nothing is sent (the dots are still drawn), and when it
  // arrives the current frame is sent again, mapped.
  const outSizeRef = useRef<Size | null>(null);
  useXmaxX21StateUpdate((msg) => {
    if (!msg.width || !msg.height) return;
    const w = msg.width;
    const h = msg.height;
    const prev = outSizeRef.current;
    if (prev?.w === w && prev?.h === h) return;
    outSizeRef.current = { w, h };
    lastFrameRef.current = -1;
  });
  const toOutput = useCallback((pts: DragPoint[]): DragPoint[] => {
    const t = trackRef.current;
    const out = outSizeRef.current;
    if (!t || !out) return pts;
    return fitPoints(pts, { w: t.width, h: t.height }, out);
  }, []);

  const halt = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    lastFrameRef.current = -1;
    if (store.get()?.from === "replay") store.set(null);
    setFrame(null);
  }, [store]);

  /** Stop replaying; `clear` also lifts the points off the model (four empty frames). */
  const stop = useCallback(
    (clear = false) => {
      if (phaseRef.current !== "off") {
        halt();
        setPhase("off");
      }
      if (clear) void setPointers(framesPayload(EMPTY_WINDOW));
    },
    [halt, setPointers],
  );

  const start = useCallback(async () => {
    const t = trackRef.current;
    const v = videoRef.current;
    if (!t || !v) throw new Error("The drag clip or its track is not loaded yet.");
    halt();
    setFailure(null);
    v.currentTime = 0;
    await v.play().catch(() => {});
    setPhase("running");

    let stopped = false;
    let handle = 0;
    // Before the track has wrapped once, frames before 0 were never shown,
    // so the window repeats frame 0 (windowIndices).
    let looped = false;
    let prevFrame = -1;
    const onFrameIndex = (f: number) => {
      if (f === lastFrameRef.current) return;
      lastFrameRef.current = f;
      if (prevFrame >= 0 && f < prevFrame) looped = true;
      prevFrame = f;
      const w: PointerWindow = windowIndices(f, t.frames.length, looped).map((i) =>
        toOutput(t.frames[i]),
      );
      setFrame(f);
      const live = phaseRef.current === "running" && !!outSizeRef.current;
      if (phaseRef.current !== "held") store.set({ window: w, from: "replay", sent: live });
      if (live) void setPointers(framesPayload(w));
    };
    const onTime = (time: number) =>
      onFrameIndex(Math.min(t.frames.length - 1, Math.max(0, Math.floor(time * t.fps))));
    if (v.requestVideoFrameCallback) {
      const step = (_now: number, meta: { mediaTime: number }) => {
        if (stopped) return;
        onTime(meta.mediaTime);
        handle = v.requestVideoFrameCallback!(step);
      };
      handle = v.requestVideoFrameCallback(step);
      cancelRef.current = () => {
        stopped = true;
        v.cancelVideoFrameCallback?.(handle);
      };
    } else {
      const step = () => {
        if (stopped) return;
        onTime(v.currentTime);
        handle = requestAnimationFrame(step);
      };
      handle = requestAnimationFrame(step);
      cancelRef.current = () => {
        stopped = true;
        cancelAnimationFrame(handle);
      };
    }
  }, [halt, toOutput, store, setPointers]);

  /** A manual drag is held (true) or released (false). Returns true when the
   *  release resumes a paused replay, which then owns the pointer stream. */
  const hold = useCallback((held: boolean): boolean => {
    if (held && phaseRef.current === "running") setPhase("held");
    else if (!held && phaseRef.current === "held") {
      setPhase("running");
      lastFrameRef.current = -1; // resend the current window
      return true;
    }
    return false;
  }, []);

  /** The model rejected a command while the replay ran: stop and say why. */
  const fail = useCallback(
    (reason: string) => {
      if (phaseRef.current !== "running" && phaseRef.current !== "held") return;
      halt();
      setFailure(reason);
      setPhase("failed");
    },
    [halt],
  );

  useEffect(() => () => cancelRef.current?.(), []);

  const isLoadedFor = useCallback((spec: DragSpec) => loadedForRef.current === spec, []);

  return { track, isLoadedFor, trackError, phase, failure, frame, setVideo, start, stop, hold, fail };
}

export type DragReplay = ReturnType<typeof useDragReplay>;

/** The latest window sent (or drawn, before the output size is known). */
export function useSentWindow(store: SentWindowStore) {
  return useSyncExternalStore(store.subscribe, store.get, () => null);
}

// The drag panel: replay / stop-and-clear for the picked example's recorded
// trajectory, and the window last sent (manual or replayed). The window
// changes every frame, so this panel subscribes to the store itself and keeps
// the re-renders local.
export function DragPanel({
  drag,
  replay,
  manual,
  store,
  running,
  onError,
}: {
  drag: DragSpec | null;
  replay: DragReplay;
  manual: ManualDrag;
  store: SentWindowStore;
  /** Generation has been started, so the drag can steer it. */
  running: boolean;
  onError: (message: string) => void;
}) {
  const sent = useSentWindow(store);
  const replaying = replay.phase === "running" || replay.phase === "held";
  const fmt = (pts: DragPoint[]) =>
    pts.length ? pts.map(([x, y]) => `(${x.toFixed(2)}, ${y.toFixed(2)})`).join(" ") : "none";
  const failure = replay.failure ?? manual.failure;

  return (
    <Panel label="Drag">
      <p className="text-xs text-zinc-400">
        {running ? "Press and drag" : "Once it runs, press and drag"} on the output to steer the
        character. Your drag pauses the recorded one while you hold it.
      </p>
      {drag && (
        <div className="mt-2 flex gap-2">
          {replaying ? (
            <Button size="sm" variant="secondary" className="flex-1" onClick={() => replay.stop(true)}>
              Stop and clear drag
            </Button>
          ) : (
            <Button
              size="sm"
              className="flex-1"
              disabled={!running || !replay.track}
              onClick={() => replay.start().catch((err: unknown) => onError(String(err)))}
            >
              Replay recorded drag
            </Button>
          )}
        </div>
      )}
      <p className="mt-2 font-mono text-[11px]">
        <span
          className={cn(
            replay.phase === "running" && "text-brand",
            replay.phase === "held" && "text-amber-300",
            replay.phase === "failed" && "text-red-400",
            replay.phase === "off" && "text-zinc-500",
          )}
        >
          {manual.phase === "dragging" || manual.phase === "releasing"
            ? "your drag"
            : replay.phase === "running"
              ? "replaying"
              : replay.phase === "held"
                ? "replay paused"
                : replay.phase === "failed"
                  ? "stopped"
                  : "no drag"}
        </span>
        {replay.frame != null && <span className="text-zinc-500"> · frame {replay.frame}</span>}
      </p>
      {sent && (
        <p
          className={cn("mt-1 truncate font-mono text-[11px]", sent.sent ? "text-zinc-300" : "text-zinc-500")}
          title={sent.window.map(fmt).join(" | ")}
        >
          {sent.sent ? "sent" : "waiting for output size"}: {describeWindow(sent.window)} · newest{" "}
          {fmt(sent.window[sent.window.length - 1])}
        </p>
      )}
      {replay.trackError && (
        <p className="mt-2 text-xs text-red-400">Track failed to load: {replay.trackError}</p>
      )}
      {failure && <p className="mt-2 text-xs text-red-400">The model rejected the drag: {failure}</p>}
    </Panel>
  );
}
