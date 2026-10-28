"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useXmaxX21 } from "../lib/model";
import {
  EMPTY_WINDOW,
  TICK_FPS,
  framesPayload,
  type DragPoint,
  type PointerWindow,
  type SentWindowStore,
} from "../lib/pointerFrames";

const SLOT_MS = 1000 / TICK_FPS;

type Sample = { t: number; x: number; y: number };

// The manual drag on the output as a stream of per-frame windows.
//
// Every raw pointer sample (press, and each move at the browser's full event
// rate, coalesced events included) is recorded with its timestamp. Time is cut
// into 1/24 s frame slots counted from the press. At each slot boundary the
// slot's position is the mean of the samples that fell in it; a slot with no
// samples carries the previous slot's position; once released, a slot is
// empty. The last FRAMES_PER_CHUNK slots are then sent as
// `set_pointers({ frames })`. The model thus gets the averaged path between
// samples, a fraction of a slot behind the cursor, rather than whichever raw
// sample happened to be latest.
//
// After release the clock keeps running until the window holds only empty
// frames, so the last chunk the model reads ends the drag, unless a paused
// replay takes over at release (`handOff`), which then sends its own window.
export type ManualPhase = "idle" | "dragging" | "releasing" | "failed";

export function useManualDrag(store: SentWindowStore) {
  const { setPointers } = useXmaxX21();
  const [phase, setPhaseState] = useState<ManualPhase>("idle");
  const phaseRef = useRef<ManualPhase>("idle");
  const setPhase = (p: ManualPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  const [failure, setFailure] = useState<string | null>(null);

  const pressedRef = useRef(false);
  const samplesRef = useRef<Sample[]>([]);
  const windowRef = useRef<PointerWindow>(EMPTY_WINDOW);
  const lastPosRef = useRef<DragPoint | null>(null);
  const t0Ref = useRef(0);
  const slotRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopClock = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const tick = useCallback(() => {
    timerRef.current = null;
    const boundary = t0Ref.current + (slotRef.current + 1) * SLOT_MS;
    const inSlot = samplesRef.current.filter((s) => s.t < boundary);
    samplesRef.current = samplesRef.current.filter((s) => s.t >= boundary);
    let pos: DragPoint[] = [];
    if (pressedRef.current) {
      if (inSlot.length) {
        const n = inSlot.length;
        lastPosRef.current = [
          inSlot.reduce((a, s) => a + s.x, 0) / n,
          inSlot.reduce((a, s) => a + s.y, 0) / n,
        ];
      }
      if (lastPosRef.current) pos = [lastPosRef.current];
    }
    const w = [...windowRef.current.slice(1), pos];
    windowRef.current = w;
    store.set({ window: w, from: "manual", sent: true });
    void setPointers(framesPayload(w));
    // A rejection can be reported (fail) while this send is still on the stack.
    if (phaseRef.current === "failed") return;
    slotRef.current++;
    const done = !pressedRef.current && w.every((f) => f.length === 0);
    if (done) {
      setPhase("idle");
      return;
    }
    // Schedule against the slot grid, not the previous timer, so slots do not drift.
    const next = t0Ref.current + (slotRef.current + 1) * SLOT_MS;
    timerRef.current = setTimeout(tick, Math.max(0, next - performance.now()));
  }, [setPointers, store]);

  const record = (t: number, x: number, y: number) => {
    samplesRef.current.push({ t, x, y });
  };

  /** Pointer pressed at (x, y), output-frame 0..1, at time t (performance.now base). */
  const press = useCallback(
    (x: number, y: number, t: number) => {
      pressedRef.current = true;
      setFailure(null);
      if (phaseRef.current !== "releasing") {
        // A fresh drag: the frames before the press had no pointer.
        stopClock();
        windowRef.current = EMPTY_WINDOW;
        samplesRef.current = [];
        lastPosRef.current = null;
        t0Ref.current = t;
        slotRef.current = 0;
        timerRef.current = setTimeout(tick, SLOT_MS);
      }
      record(t, x, y);
      setPhase("dragging");
    },
    [stopClock, tick],
  );

  /** Raw samples from one pointermove (its coalesced events). */
  const move = useCallback((samples: { x: number; y: number; t: number }[]) => {
    if (!pressedRef.current) return;
    for (const s of samples) record(s.t, s.x, s.y);
  }, []);

  /** Pointer released. `handOff`: a paused replay resumes and owns the stream. */
  const release = useCallback(
    (handOff = false) => {
      if (!pressedRef.current) return;
      pressedRef.current = false;
      samplesRef.current = [];
      if (handOff) {
        stopClock();
        setPhase("idle");
        return;
      }
      setPhase("releasing");
    },
    [stopClock],
  );

  /** The model rejected a command while the drag streamed: stop and say why. */
  const fail = useCallback(
    (reason: string) => {
      if (phaseRef.current !== "dragging" && phaseRef.current !== "releasing") return;
      stopClock();
      pressedRef.current = false;
      setFailure(reason);
      setPhase("failed");
    },
    [stopClock],
  );

  useEffect(() => () => stopClock(), [stopClock]);

  return { phase, failure, press, move, release, fail };
}

export type ManualDrag = ReturnType<typeof useManualDrag>;
