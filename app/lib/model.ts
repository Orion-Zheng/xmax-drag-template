"use client";

// The one module the app imports the model from: the typed client for
// reactor/xmax-x2-1. XmaxX21Provider fixes the model name and tracks; the hooks
// give typed commands (setPrompt, setReferenceImage, setPointers, reset, …)
// and typed messages (state_update, generation_stopped, …).
//
// With `?debug=1` in the URL, every command the page sends and every
// state_update / generation_started / generation_stopped it receives is
// written to the browser console, prefixed "[x21]" (see useDebugLog). Without
// it, useXmaxX21 is the package's hook, unchanged.
import { useMemo } from "react";
import {
  useXmaxX21 as useXmaxX21Raw,
  useXmaxX21GenerationStarted,
  useXmaxX21GenerationStopped,
  useXmaxX21StateUpdate,
} from "@reactor-models/xmax-x2-1";

export {
  MODEL_NAME,
  XmaxX21MainVideoView,
  XmaxX21Provider,
  useXmaxX21GenerationStarted,
  useXmaxX21GenerationStopped,
  useXmaxX21StateUpdate,
  type XmaxX21StateUpdateMessage,
} from "@reactor-models/xmax-x2-1";

// MODEL_NAME above is "reactor/xmax-x2-1"; it must equal MODEL_NAME in
// app/api/reactor/token/route.ts, which scopes the token to this model.
export const REACTOR_API_URL = "https://api.reactor.inc";

// ---- ?debug=1 --------------------------------------------------------------

export const DEBUG =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("debug") === "1";

export function dlog(...parts: unknown[]) {
  if (!DEBUG) return;
  console.info(`[x21] ${new Date().toISOString().slice(11, 23)}`, ...parts);
}

type Point = { x: number; y: number };

// A short, key-free summary of a command's arguments. connect / disconnect are
// logged without arguments (connect may carry a token).
function summarize(name: string, args: unknown[]): string {
  const a = args[0] as Record<string, unknown> | undefined;
  switch (name) {
    case "setPointers": {
      const frames = (a?.frames ?? []) as Point[][];
      const newest = frames[frames.length - 1] ?? [];
      return `frames=[${frames.map((f) => f.length).join(",")}] newest=${newest
        .map((p) => `(${p.x.toFixed(2)},${p.y.toFixed(2)})`)
        .join(" ") || "none"}`;
    }
    case "setPrompt":
      return `prompt=${JSON.stringify(String(a?.prompt ?? "").slice(0, 80))}`;
    case "setReferenceImage":
      return "reference_image=<uploaded file>";
    case "uploadFile": {
      const blob = args[0] as Blob | undefined;
      const opts = args[1] as { name?: string } | undefined;
      return `name=${opts?.name ?? "?"} bytes=${blob?.size ?? "?"}`;
    }
    case "publish":
    case "unpublish":
      return `track=${String(args[0])}`;
    default:
      return "";
  }
}

const LOGGED = [
  "reset",
  "setPrompt",
  "setReferenceImage",
  "setPointers",
  "uploadFile",
  "publish",
  "unpublish",
  "connect",
  "disconnect",
] as const;

type Store = ReturnType<typeof useXmaxX21Raw>;

/** The package's hook; with ?debug=1, its commands also log to the console.
 *  The wrapped functions keep a stable identity while the originals do. */
export function useXmaxX21(): Store {
  const raw = useXmaxX21Raw();
  const deps = LOGGED.map((m) => raw[m]);
  const wrapped = useMemo(() => {
    if (!DEBUG) return null;
    const out: Record<string, unknown> = {};
    for (const m of LOGGED) {
      const fn = raw[m] as (...args: unknown[]) => unknown;
      out[m] = (...args: unknown[]) => {
        dlog("send", m, summarize(m, args));
        return fn(...args);
      };
    }
    return out as Partial<Store>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return wrapped ? { ...raw, ...wrapped } : raw;
}

/** With ?debug=1, logs every state_update / generation_started / generation_stopped. */
export function useDebugLog() {
  useXmaxX21StateUpdate((m) => {
    if (!DEBUG) return;
    dlog(
      "recv state_update",
      `generating=${m.generating} prompt=${JSON.stringify(m.prompt)} ref=${m.has_reference_image}`,
      `pointers=${JSON.stringify(m.pointers)} size=${m.width}x${m.height}`,
    );
  });
  useXmaxX21GenerationStarted((m) => {
    if (DEBUG) dlog("recv generation_started", JSON.stringify(m));
  });
  useXmaxX21GenerationStopped((m) => {
    if (DEBUG) dlog("recv generation_stopped", JSON.stringify(m));
  });
}
