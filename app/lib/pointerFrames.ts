// Per-frame pointer windows for `set_pointers({ frames })`.
//
// The model generates in chunks of FRAMES_PER_CHUNK frames and, once per
// chunk, reads the latest window it was sent: one list of points per frame,
// oldest -> newest, and draws frame i's points on control frame i. The page
// therefore sends, at every one of its own frame ticks, the positions of the
// last FRAMES_PER_CHUNK frames; whenever the server starts a chunk, it finds
// the four most recent per-frame positions.
//
// Points are normalised to the output frame, 0..1, at most MAX_POINTS per
// frame; an empty list means no drag on that frame.

export type DragPoint = [number, number];
/** FRAMES_PER_CHUNK lists of points, oldest -> newest. */
export type PointerWindow = DragPoint[][];

export const FRAMES_PER_CHUNK = 4;
export const MAX_POINTS = 8;
/** The page's own frame clock for the manual drag. */
export const TICK_FPS = 24;

export const EMPTY_WINDOW: PointerWindow = Array.from({ length: FRAMES_PER_CHUNK }, () => []);

/** The `set_pointers` payload for a window. */
export function framesPayload(w: PointerWindow) {
  return { frames: w.map((pts) => pts.map(([x, y]) => ({ x, y }))) };
}

/** Frame indices [f-3, f-2, f-1, f] of a looping track of `length` frames.
 *  Before the track has looped once, indices before 0 repeat frame 0 (those
 *  frames were never shown); after a loop they wrap to the track's end, which
 *  is what was shown just before frame 0. */
export function windowIndices(f: number, length: number, looped: boolean): number[] {
  return Array.from({ length: FRAMES_PER_CHUNK }, (_, k) => {
    const i = f - (FRAMES_PER_CHUNK - 1 - k);
    if (i >= 0) return i;
    return looped ? ((i % length) + length) % length : 0;
  });
}

/** "4 frames × N points" (or the per-frame counts when they differ). */
export function describeWindow(w: PointerWindow): string {
  const counts = w.map((pts) => pts.length);
  const same = counts.every((c) => c === counts[0]);
  const n = same ? `${counts[0]}` : `(${counts.join(", ")})`;
  return `${w.length} frames × ${n} point${same && counts[0] === 1 ? "" : "s"}`;
}

// The latest window the page has sent (or, before the output size is known,
// would send), shared by the overlay that draws it and the Drag slot that
// describes it. It changes at the frame rate, so it lives in a small external
// store that only those two subscribe to, rather than in the workspace's
// React state.
export type SentWindow = {
  window: PointerWindow;
  from: "replay" | "manual";
  /** false: drawn only, held back until the output size is known. */
  sent: boolean;
};

export type SentWindowStore = {
  get: () => SentWindow | null;
  set: (next: SentWindow | null) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createSentWindowStore(): SentWindowStore {
  let value: SentWindow | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
