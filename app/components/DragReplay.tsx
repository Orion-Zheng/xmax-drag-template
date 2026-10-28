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

// Replays a drag example's recorded pointer trajectory over the still image
// streamed as the source.
//
// The track holds one list of points per frame. Every frame of a still is the
// same picture, so a clock times the replay: the position advances by
// elapsed * fps * speed each animation frame, and frame = floor(position)
// modulo the track length. Changing the speed mid-replay keeps the position. Each time the frame f
// changes, the points of frames f-3..f
// are sent as one window,
// `set_pointers({ frames: [pts(f-3), pts(f-2), pts(f-1), pts(f)] })`
// (normalised 0..1, empty = no drag on that frame; see lib/pointerFrames), so
// whenever the model starts a chunk it has the four latest per-frame
// positions.
//
// A manual drag on the output takes over while it is held (`hold(true)`): the
// replay's clock keeps running but sends nothing; on release the current
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

/** `still`: the streamed still's frame size (from ImageSource), null until it is drawn. */
/** Replay speed on load: the recordings read too fast at their own pace. */
const DEFAULT_REPLAY_SPEED = 0.5;
const MIN_REPLAY_SPEED = 0.1;
const MAX_REPLAY_SPEED = 1.5;

export function useDragReplay(
  drag: DragSpec | null,
  still: Size | null,
  store: SentWindowStore,
) {
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
  // Replay speed relative to the recording (1 = as recorded).
  const [speed, setSpeedState] = useState(DEFAULT_REPLAY_SPEED);
  const speedRef = useRef(DEFAULT_REPLAY_SPEED);
  const setSpeed = useCallback((v: number) => {
    speedRef.current = v;
    setSpeedState(v);
  }, []);

  const stillRef = useRef<Size | null>(still);
  stillRef.current = still;
  // The still the running replay is mapped against (fixed at start).
  const replayStillRef = useRef<Size | null>(null);
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

  // The track is in the frame of the clip it was recorded on; set_pointers
  // takes the output frame. A point is first placed in the still's frame by
  // the same fit, treating the recording as the still fitted to its size (the
  // still is the recording's opening picture, framed about the same), then
  // goes through the fit the server applies from source to output (fitPoints). The output size arrives in state_update once the run has
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
    if (!t) return pts;
    const control = { w: t.width, h: t.height };
    const st = replayStillRef.current;
    const inSource = st ? fitPoints(pts, control, st) : pts;
    return out ? fitPoints(inSource, st ?? control, out) : inSource;
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
    const st = stillRef.current;
    if (!t || !st) throw new Error("The source image or the drag track is not loaded yet.");
    halt();
    setFailure(null);
    replayStillRef.current = st;
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
    let last = performance.now();
    let position = 0;
    const step = (now: number) => {
      if (stopped) return;
      position += (Math.max(0, now - last) / 1000) * t.fps * speedRef.current;
      last = now;
      onFrameIndex(Math.floor(position) % t.frames.length);
      handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);
    cancelRef.current = () => {
      stopped = true;
      cancelAnimationFrame(handle);
    };
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

  return { track, isLoadedFor, trackError, phase, failure, frame, speed, setSpeed, start, stop, hold, fail };
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
        {running ? "Press and drag" : "Once an example is running, press and drag"} on the output
        to steer the character.
      </p>
      {drag && drag.points > 1 && (
        <div className="mt-2 flex gap-2">
          {replaying ? (
            <Button size="sm" variant="secondary" className="flex-1" onClick={() => replay.stop(true)}>
              Stop multi-point drag
            </Button>
          ) : (
            <Button
              size="sm"
              className="flex-1"
              disabled={!running || !replay.track}
              onClick={() => replay.start().catch((err: unknown) => onError(String(err)))}
            >
              Try multi-point drag
            </Button>
          )}
        </div>
      )}
      {(!drag || drag.points === 1) && (
        <p className="mt-2 text-[11px] text-zinc-500">
          New here? Start the first example, the anime girl, and press “Try multi-point drag” to see
          several points steer her at once.
        </p>
      )}
      {drag && drag.points > 1 && (
        <label className="mt-3 block text-[11px] text-zinc-400" htmlFor="replay-speed">
          <span className="flex justify-between">
            <span>Replay speed</span>
            <span className="font-mono text-zinc-300">{replay.speed.toFixed(2)}×</span>
          </span>
          <input
            id="replay-speed"
            type="range"
            min={MIN_REPLAY_SPEED}
            max={MAX_REPLAY_SPEED}
            step={0.05}
            value={replay.speed}
            onChange={(e) => replay.setSpeed(Number(e.target.value))}
            className="mt-1 w-full accent-brand"
          />
        </label>
      )}
      {drag && drag.points > 1 && (
        <p className="mt-1 text-[11px] text-zinc-500">
          Replays a recorded {drag.points}-point drag over the image. Your own drag pauses it while
          you hold.
        </p>
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
