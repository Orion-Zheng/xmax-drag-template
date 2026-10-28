"use client";

import { useEffect, useRef, useState } from "react";
import { useXmaxX21 } from "../lib/model";
import type { SentWindowStore } from "../lib/pointerFrames";
import { useSentWindow } from "./DragReplay";
import type { ManualDrag } from "./useManualDrag";

// Drag-to-steer overlay for the edited output pane. While the user holds the
// pointer down, every raw pointer sample (with its timestamp) goes to the
// manual drag stream (useManualDrag), which averages them into 1/24 s frames
// and sends the last 4 frames as set_pointers. Coordinates are normalized to
// the *output frame*, which the pane letterboxes (object-fit: contain) —
// outputAspect (from generation_started's width/height) is used to map from
// the pane's box to the visible video content, so 0..1 means the frame, not
// the letterbox.
//
// The overlay also draws the window last sent (manual or a replayed
// trajectory): each frame's points as small dots, older frames fainter, the
// newest frame as a ring. Holding a manual drag pauses a replay (onDragHold)
// so the two never steer at once.
export function PointerOverlay({
  outputAspect,
  enabled,
  manual,
  store,
  onDragHold,
}: {
  /** width / height of the negotiated output, or null before generation. */
  outputAspect: number | null;
  enabled: boolean;
  manual: ManualDrag;
  store: SentWindowStore;
  /** Pressed (true) / released (false); returns true when a paused replay takes over on release. */
  onDragHold?: (held: boolean) => boolean | void;
}) {
  const { status } = useXmaxX21();
  const ref = useRef<HTMLDivElement>(null);
  const [dot, setDot] = useState<{ left: number; top: number } | null>(null);
  const sent = useSentWindow(store);

  const draggingRef = useRef(false);

  const active = enabled && status === "ready";

  // The pane's size, to place the drawn window inside the letterboxed frame.
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const frameBox = (() => {
    if (!box || !box.w || !box.h) return null;
    let w = box.w, h = box.h;
    if (outputAspect && outputAspect > 0) {
      if (box.w / box.h > outputAspect) w = box.h * outputAspect;
      else h = box.w / outputAspect;
    }
    return { left: (box.w - w) / 2, top: (box.h - h) / 2, w, h };
  })();

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDot(null);
    const handOff = onDragHold?.(false) === true;
    manual.release(handOff);
  };

  // End a drag that's still active on unmount/disable so the model doesn't
  // keep steering toward a stale point.
  useEffect(() => {
    if (!active) endDrag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Map a pointer event to output-frame coordinates (0,0 = top left, clamped
  // to 0..1) plus the dot's position within the pane, accounting for the
  // letterbox object-fit: contain introduces when the pane and the output
  // frame have different aspect ratios.
  function locate(e: { clientX: number; clientY: number }): {
    x: number;
    y: number;
    left: number;
    top: number;
  } | null {
    const el = ref.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    let cx = rect.left;
    let cy = rect.top;
    let cw = rect.width;
    let ch = rect.height;
    const aspect = outputAspect;
    if (aspect && aspect > 0) {
      const paneAspect = rect.width / rect.height;
      if (paneAspect > aspect) {
        cw = rect.height * aspect;
        cx = rect.left + (rect.width - cw) / 2;
      } else {
        ch = rect.width / aspect;
        cy = rect.top + (rect.height - ch) / 2;
      }
    }

    const x = Math.min(1, Math.max(0, (e.clientX - cx) / cw));
    const y = Math.min(1, Math.max(0, (e.clientY - cy) / ch));
    return {
      x,
      y,
      left: cx - rect.left + x * cw,
      top: cy - rect.top + y * ch,
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!active) return;
    const p = locate(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    onDragHold?.(true);
    setDot({ left: p.left, top: p.top });
    manual.press(p.x, p.y, e.timeStamp);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    // Every raw sample the browser merged into this event, at full rate.
    const raw = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const events = raw.length ? raw : [e.nativeEvent];
    const samples: { x: number; y: number; t: number }[] = [];
    for (const ev of events) {
      const q = locate(ev);
      if (q) samples.push({ x: q.x, y: q.y, t: ev.timeStamp });
    }
    const p = locate(e);
    if (p) setDot({ left: p.left, top: p.top });
    manual.move(samples);
  }

  function onPointerEnd() {
    endDrag();
  }

  return (
    <div
      ref={ref}
      data-testid="pointer-overlay"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      className={
        "absolute inset-0 touch-none select-none " +
        (active ? "cursor-crosshair" : "pointer-events-none")
      }
    >
      {/* The window last sent: frames 0..2 as dots (older = fainter), frame 3
          (the newest) as a ring. */}
      {frameBox &&
        sent?.window.map((pts, k) => {
          const newest = k === sent.window.length - 1;
          return pts.map(([x, y], i) => (
            <span
              key={`${k}-${i}`}
              data-testid={newest ? "window-newest" : "window-point"}
              data-frame={k}
              className={
                "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full " +
                (newest
                  ? "h-3.5 w-3.5 border-2 border-sky-300 shadow-[0_0_8px_1px] shadow-sky-400/60"
                  : "h-2 w-2 bg-sky-400")
              }
              style={{
                left: frameBox.left + x * frameBox.w,
                top: frameBox.top + y * frameBox.h,
                opacity: newest ? 1 : 0.35 + 0.2 * k,
              }}
            />
          ));
        })}
      {/* The drag marker: a press ripple (one-shot — the marker mounts on
          pointerdown and unmounts on release, so the animation runs once per
          drag), a brand-glow ring that follows the cursor itself (the sent
          window trails it by the averaging). */}
      {dot && (
        <span
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: dot.left, top: dot.top }}
        >
          <span className="absolute -inset-4 animate-pointer-press rounded-full border-2 border-brand" />
          <span className="block h-7 w-7 rounded-full border-2 border-white/90 bg-brand/20 shadow-[0_0_16px_2px] shadow-brand/50" />
          <span className="absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
        </span>
      )}
    </div>
  );
}
