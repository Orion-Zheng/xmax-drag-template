"use client";

// The session half of the page. Pick an example: the page connects (with the visitor's
// own API key), resets the model, sends the example's reference image and
// prompt, streams its clip as the `source` track and replays its recorded
// drag over it with set_pointers. Press and drag on the output to steer by
// hand at any time.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  REACTOR_API_URL,
  XmaxX21Provider,
  useXmaxX21,
  useXmaxX21GenerationStopped,
  useXmaxX21StateUpdate,
  type XmaxX21StateUpdateMessage,
} from "./lib/model";
import { getApiKey, useApiKey, useApiKeyEpoch } from "./lib/api-key";
import { fetchToken } from "./lib/token";
import { EXAMPLES, media, type DragExample } from "./lib/examples";
import { DEFAULT_UI_STATE, type UiState } from "./lib/types";
import { reduce } from "./lib/state";
import { createSentWindowStore } from "./lib/pointerFrames";
import { fileFromUrl, useReferenceUpload } from "./lib/reference";
import { StatusBadge } from "./components/StatusBadge";
import { CommandError } from "./components/CommandError";
import { Stage } from "./components/Stage";
import { DragPanel, useDragReplay } from "./components/DragReplay";
import { useManualDrag } from "./components/useManualDrag";
import { useSourcePublisher } from "./components/useSourcePublisher";
import { Button, Panel, cn, errorMessage } from "./components/ui";

export function DragSession() {
  // A new key ends the old key's session: the provider remounts on a new epoch.
  const epoch = useApiKeyEpoch();
  return (
    <XmaxX21Provider
      key={epoch}
      apiUrl={REACTOR_API_URL}
      jwtToken={fetchToken}
      connectOptions={{ autoConnect: false }}
    >
      <Workspace />
    </XmaxX21Provider>
  );
}

const BANNER_TTL_MS = 6000;
// The server frees the model's slot a moment after a session ends, so a new
// session right after our own disconnect can get a 429 for a few seconds.
const RECENT_END_MS = 10_000;
const RETRY_WINDOW_MS = 6_000;

/** Resolve when `ok()` holds, polling; reject after `ms`. */
function waitFor(ok: () => boolean, ms: number, what: string) {
  return new Promise<void>((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (ok()) return resolve();
      if (Date.now() - t0 > ms) return reject(new Error(what));
      setTimeout(tick, 100);
    };
    tick();
  });
}

type Phase = "idle" | "busy" | "running";

function Workspace() {
  const { status, lastError, connect, disconnect, reset, setPrompt } = useXmaxX21();
  const statusRef = useRef(status);
  statusRef.current = status;
  const apiKey = useApiKey();

  const [ui, setUi] = useState<UiState>(DEFAULT_UI_STATE);
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const [selected, setSelected] = useState<DragExample | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;
  const [needKey, setNeedKey] = useState(false);
  const [stageCleared, setStageCleared] = useState(false);

  // The source clip's track is published only after the model has confirmed a
  // reset in this session, so no frame ever meets a previous session's state.
  const [sourceTrack, setSourceTrack] = useState<MediaStreamTrack | null>(null);
  const [sessionClean, setSessionClean] = useState(false);
  const publishError = useSourcePublisher(sessionClean ? sourceTrack : null);

  const sentWindow = useMemo(createSentWindowStore, []);
  const replay = useDragReplay(selected?.drag ?? null, sentWindow);
  const manual = useManualDrag(sentWindow);
  const refUpload = useReferenceUpload();
  const { stop: stopReplay, fail: failReplay, isLoadedFor, start: startReplay } = replay;
  const { fail: failManual } = manual;

  const [commandError, setCommandError] = useState<string | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showError = useCallback((reason: string) => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setCommandError(reason);
    bannerTimer.current = setTimeout(() => setCommandError(null), BANNER_TTL_MS);
  }, []);
  useEffect(() => () => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
  }, []);

  useEffect(() => {
    if (apiKey) setNeedKey(false);
  }, [apiKey]);

  // ---- messages from the model -------------------------------------------
  const stateWaiters = useRef<((m: XmaxX21StateUpdateMessage) => boolean)[]>([]);
  useXmaxX21StateUpdate((msg) => {
    stateWaiters.current = stateWaiters.current.filter((w) => !w(msg));
    if (msg.generating) setStageCleared(false);
    setUi((s) => reduce(s, msg));
  });
  useXmaxX21GenerationStopped(() => setStageCleared(true));

  const seenError = useRef(lastError);
  useEffect(() => {
    if (lastError && lastError !== seenError.current) {
      const reason = `[${lastError.code}] ${lastError.message}`;
      showError(reason);
      failReplay(reason);
      failManual(reason);
    }
    seenError.current = lastError;
  }, [lastError, showError, failReplay, failManual]);

  const lastEnd = useRef(0);
  const prevStatus = useRef(status);
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    if (status !== "ready") {
      setSessionClean(false);
      // A run in progress (busy) is connecting right now and settles itself.
      if (phaseRef.current !== "busy") setPhase("idle");
      stopReplay();
    }
    if (status === "disconnected") {
      if (was !== "disconnected") lastEnd.current = Date.now();
      setUi(DEFAULT_UI_STATE);
      setStageCleared(false);
    }
  }, [status, stopReplay]);

  // ---- the start sequence --------------------------------------------------
  // "Clean" = a state_update with no prompt, no reference and not generating;
  // the model's reset always ends by sending one.
  const waitClean = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          stateWaiters.current = stateWaiters.current.filter((w) => w !== check);
          reject(new Error("The model did not confirm the reset within 15 s."));
        }, 15_000);
        const check = (m: XmaxX21StateUpdateMessage) => {
          const clean = !m.prompt && !m.has_reference_image && !m.generating;
          if (clean) {
            clearTimeout(timer);
            resolve();
          }
          return clean;
        };
        stateWaiters.current.push(check);
      }),
    [],
  );

  const cleanReset = useCallback(async () => {
    stopReplay();
    const confirmed = waitClean(); // listen before sending
    Promise.resolve(reset()).catch(() => {});
    await confirmed;
    setSessionClean(true);
  }, [reset, waitClean, stopReplay]);

  const ensureConnected = useCallback(async () => {
    if (statusRef.current === "disconnected") {
      const recentEnd = Date.now() - lastEnd.current < RECENT_END_MS;
      const deadline = Date.now() + RETRY_WINDOW_MS;
      for (;;) {
        try {
          await Promise.resolve(connect());
          break;
        } catch (err) {
          const m = errorMessage(err);
          const busy = /429|no available capacity/i.test(m);
          if (busy && recentEnd && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          throw new Error(busy ? "No GPU is free right now (429). Try again in a moment." : m);
        }
      }
    }
    await waitFor(
      () => statusRef.current === "ready",
      180_000,
      "The session did not become ready within 3 minutes.",
    );
  }, [connect]);

  const runStep = useCallback(
    async (fn: () => Promise<Phase>) => {
      if (phaseRef.current === "busy") return;
      setPhase("busy");
      phaseRef.current = "busy";
      try {
        setPhase(await fn());
      } catch (err) {
        showError(errorMessage(err));
        setPhase("idle");
      }
    },
    [showError],
  );

  // reset -> clean state_update -> reference image -> prompt -> (the source
  // clip is published once the reset is confirmed) -> replay the recorded drag.
  const run = (example: DragExample) => {
    if (!getApiKey()) {
      setNeedKey(true);
      return;
    }
    setNeedKey(false);
    setSelected(example);
    void runStep(async () => {
      await ensureConnected();
      await cleanReset();
      const ok = await refUpload.apply(await fileFromUrl(media(example.refs[0])));
      if (!ok) return "idle";
      await setPrompt({ prompt: example.prompt });
      await waitFor(() => isLoadedFor(example.drag), 10_000, "The drag track did not load.");
      await startReplay();
      return "running";
    });
  };

  const stop = () =>
    runStep(async () => {
      await cleanReset();
      return "idle";
    });

  const leave = () =>
    runStep(async () => {
      if (uiRef.current.generating || phaseRef.current === "running") {
        await Promise.race([cleanReset(), new Promise((r) => setTimeout(r, 3000))]).catch(() => {});
      }
      await Promise.resolve(disconnect()).catch(() => {});
      return "idle";
    });

  // End the session when the page goes away, so it does not hold the GPU
  // until the server times it out.
  useEffect(() => {
    const end = () => {
      if (statusRef.current === "disconnected") return;
      if (uiRef.current.generating) Promise.resolve(reset()).catch(() => {});
      void disconnect();
    };
    window.addEventListener("pagehide", end);
    return () => {
      window.removeEventListener("pagehide", end);
      end();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = phase === "busy";
  const hint = !selected
    ? "Pick an example to start."
    : busy
      ? status === "connecting"
        ? "Connecting…"
        : status === "waiting"
          ? "Waiting for a GPU…"
          : "Starting…"
      : phase === "running"
        ? "Waiting for the first frames…"
        : "Stopped. Pick an example to run it again.";

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:min-h-0 lg:flex-row lg:gap-6 lg:p-6">
      <section className="flex min-h-0 flex-col lg:min-w-0 lg:flex-1">
        <Stage
          ui={ui}
          hint={hint}
          videoUrl={selected ? media(selected.drag.source) : null}
          cleared={stageCleared}
          onTrack={setSourceTrack}
          onVideo={replay.setVideo}
          manual={manual}
          sentWindow={sentWindow}
          replayAspect={replay.track ? replay.track.width / replay.track.height : null}
          onDragHold={replay.hold}
        />
      </section>
      <aside className="flex w-full flex-col gap-4 lg:min-h-0 lg:w-80 lg:shrink-0 lg:overflow-y-auto">
        <Panel label="Examples">
          <div className="grid grid-cols-2 gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.id}
                type="button"
                disabled={busy}
                onClick={() => run(ex)}
                className={cn(
                  "overflow-hidden rounded-md border text-left transition disabled:opacity-60",
                  selected?.id === ex.id
                    ? "border-brand"
                    : "border-zinc-800 hover:border-zinc-600",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={media(ex.thumb)} alt="" className="aspect-[3/4] w-full object-cover" />
                <span className="block px-2 py-1.5 text-xs text-zinc-200">{ex.titleEn}</span>
                <span className="block px-2 pb-1.5 text-[11px] text-zinc-500">
                  {ex.drag.points} point{ex.drag.points > 1 ? "s" : ""} ·{" "}
                  {(ex.drag.frames / ex.drag.fps).toFixed(1)} s loop
                </span>
              </button>
            ))}
          </div>
          {needKey && (
            <p className="mt-2 text-xs text-amber-300">
              Paste your Reactor API key at the top of the page first.
            </p>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="mt-3 w-full"
            disabled={busy || phase !== "running"}
            onClick={() => void stop()}
          >
            {busy ? "Working…" : "Stop"}
          </Button>
        </Panel>
        {commandError && (
          <CommandError message={commandError} onDismiss={() => setCommandError(null)} />
        )}
        {publishError && <p className="text-xs text-red-400">Source: {publishError}</p>}
        <DragPanel
          drag={selected?.drag ?? null}
          replay={replay}
          manual={manual}
          store={sentWindow}
          running={phase === "running"}
          onError={showError}
        />
        <StatusBadge onDisconnect={() => void leave()} />
      </aside>
    </main>
  );
}
