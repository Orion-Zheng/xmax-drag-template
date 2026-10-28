"use client";

// The page. Connect (with the visitor's own API key) from the header, then
// Start an example: the page resets the model, streams the example's source
// (a drag example's starting image as a still, or a video example's clip) as
// the `source` track, and sends its reference image and prompt. Press and drag
// on the output to steer; a multi-point example can also replay its recorded
// drag on request, and a video example's prompt and reference can be changed
// live. Reset clears the model for the next run.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  REACTOR_API_URL,
  XmaxX21Provider,
  useXmaxX21,
  useXmaxX21GenerationStarted,
  useXmaxX21GenerationStopped,
  useXmaxX21StateUpdate,
  type XmaxX21StateUpdateMessage,
} from "./lib/model";
import { getApiKey, useApiKey, useApiKeyEpoch } from "./lib/api-key";
import { fetchToken } from "./lib/token";
import { EXAMPLES, media, sourceUrl, type Example } from "./lib/examples";
import { DEFAULT_UI_STATE, type UiState } from "./lib/types";
import { reduce } from "./lib/state";
import { createSentWindowStore } from "./lib/pointerFrames";
import { fileFromUrl, useReferenceUpload } from "./lib/reference";
import { ApiKeyBar } from "./components/ApiKeyBar";
import { ConnectBar } from "./components/ConnectBar";
import { CommandError } from "./components/CommandError";
import { Stage, type StageSource } from "./components/Stage";
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
  const [selected, setSelected] = useState<Example>(EXAMPLES[0]);
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;
  const [needKey, setNeedKey] = useState(false);

  // ---- the output cover ----------------------------------------------------
  // `blank` hides the output. It is set the moment a Start, switch or Reset
  // begins, and cleared only by the NEW run: `armed` is raised once the clean
  // post-reset state_update has been seen, and only after that does a
  // generating state_update / generation_started clear the cover. State
  // updates from the previous run that arrive before the reset is processed
  // still say generating: true; unarmed, they are ignored.
  const [blank, setBlank] = useState(true);
  const armedRef = useRef(false);
  const blankNow = useCallback(() => {
    armedRef.current = false;
    setBlank(true);
  }, []);

  // ---- the source ----------------------------------------------------------
  // The producer (ImageSource / VideoSource) hands its track here. A track is
  // tagged with the source URL it was produced for, so a run can wait for the
  // track of ITS example. The track is published only while `sourceOn`, which
  // a run turns off when it begins (the old source is unpublished) and on once
  // the model has confirmed the reset.
  const source: StageSource =
    selected.kind === "video"
      ? { kind: "video", url: sourceUrl(selected), poster: media(selected.thumb) }
      : { kind: "image", url: sourceUrl(selected), poster: sourceUrl(selected) };
  const currentSourceRef = useRef(source.url);
  currentSourceRef.current = source.url;
  const [sourceTrack, setSourceTrack] = useState<MediaStreamTrack | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const trackUrlRef = useRef<string | null>(null);
  const onTrack = useCallback((t: MediaStreamTrack | null) => {
    trackRef.current = t;
    trackUrlRef.current = t ? currentSourceRef.current : null;
    setSourceTrack(t);
  }, []);
  // The streamed source's frame size: maps and times the recorded drag.
  const [sourceFrame, setSourceFrame] = useState<{ w: number; h: number } | null>(null);
  const [sourceOn, setSourceOn] = useState(false);
  const { error: publishError, publishedRef } = useSourcePublisher(sourceOn ? sourceTrack : null);

  const sentWindow = useMemo(createSentWindowStore, []);
  const dragSpec = selected.kind === "drag" ? selected.drag : null;
  const replay = useDragReplay(dragSpec, dragSpec ? sourceFrame : null, sentWindow);
  const manual = useManualDrag(sentWindow);
  const refUpload = useReferenceUpload();
  const { stop: stopReplay, fail: failReplay } = replay;
  const { fail: failManual } = manual;

  // ---- video example: editable prompt and reference --------------------------
  // `refImage.file` is set for the visitor's own upload; otherwise `src` is the
  // example's image. `applied` is what the model holds, for the Apply button.
  const [promptText, setPromptText] = useState(EXAMPLES[0].prompt);
  const [refImage, setRefImageState] = useState<{ src: string; file: File | null }>({
    src: media(EXAMPLES[0].refs[0]),
    file: null,
  });
  const setRefImage = (next: { src: string; file: File | null }) =>
    setRefImageState((prev) => {
      if (prev.src !== next.src && prev.src.startsWith("blob:") && prev.src !== applied?.refSrc)
        URL.revokeObjectURL(prev.src);
      return next;
    });
  const [applied, setApplied] = useState<{ prompt: string; refSrc: string } | null>(null);
  const [applying, setApplying] = useState(false);

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
    if (msg.generating && armedRef.current) setBlank(false);
    setUi((s) => reduce(s, msg));
  });
  useXmaxX21GenerationStarted(() => {
    if (armedRef.current) setBlank(false);
  });
  // The reset's generation_stopped precedes its clean state_update, so this
  // only re-covers; it does not disarm a run that is about to start.
  useXmaxX21GenerationStopped(() => setBlank(true));

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
      setSourceOn(false);
      blankNow();
      // A run in progress (busy) is connecting right now and settles itself.
      if (phaseRef.current !== "busy") setPhase("idle");
      stopReplay();
    }
    if (status === "disconnected") {
      if (was !== "disconnected") lastEnd.current = Date.now();
      setUi(DEFAULT_UI_STATE);
      setApplied(null);
    }
  }, [status, stopReplay, blankNow]);

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

  // Cover the output and take the source off the wire at once, then reset and
  // wait for the model to confirm it.
  const cleanReset = useCallback(async () => {
    blankNow();
    setSourceOn(false);
    stopReplay();
    setApplied(null);
    const confirmed = waitClean(); // listen before sending
    Promise.resolve(reset()).catch(() => {});
    await confirmed;
  }, [reset, waitClean, stopReplay, blankNow]);

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

  const connectNow = () => {
    if (!getApiKey()) {
      setNeedKey(true);
      return;
    }
    setNeedKey(false);
    void runStep(async () => {
      await ensureConnected();
      return "idle";
    });
  };

  // cover + unpublish the old source -> reset -> clean state_update -> publish
  // this example's source and wait until it is on the wire -> reference image
  // -> arm the cover -> prompt (generation starts). No drag is sent until the
  // person drags, or asks for the recorded multi-point drag.
  const run = (example: Example, prompt: string, ref: { src: string; file: File | null }) =>
    runStep(async () => {
      await cleanReset();
      const url = sourceUrl(example);
      await waitFor(
        () => trackUrlRef.current === url && !!trackRef.current,
        15_000,
        "The example's source did not load.",
      );
      setSourceOn(true);
      await waitFor(
        () => !!trackRef.current && publishedRef.current === trackRef.current,
        15_000,
        "The source could not be published.",
      );
      const ok = await refUpload.apply(ref.file ?? (await fileFromUrl(ref.src)));
      if (!ok) return "idle";
      armedRef.current = true;
      await setPrompt({ prompt });
      setApplied({ prompt, refSrc: ref.src });
      return "running";
    });

  const defaultsOf = (ex: Example) => ({
    prompt: ex.prompt,
    ref: { src: media(ex.refs[0]), file: null },
  });

  const start = () =>
    void (selected.kind === "video"
      ? run(selected, promptText.trim(), refImage)
      : run(selected, selected.prompt, defaultsOf(selected).ref));

  // Picking another example while one runs switches to it (with that
  // example's own prompt and reference); otherwise it only selects it.
  const choose = (example: Example) => {
    if (busy || example.id === selected.id) return;
    const d = defaultsOf(example);
    setSelected(example);
    setPromptText(d.prompt);
    setRefImage(d.ref);
    if (phase === "running") void run(example, d.prompt, d.ref);
  };

  const stop = () =>
    runStep(async () => {
      await cleanReset();
      return "idle";
    });

  // Video example, while running: send what changed, without a reset.
  const promptDirty = !!applied && promptText.trim() !== applied.prompt;
  const refDirty = !!applied && refImage.src !== applied.refSrc;
  const applyLive = async () => {
    if (!applied || applying || phase !== "running") return;
    setApplying(true);
    try {
      if (refDirty) {
        const ok = await refUpload.apply(refImage.file ?? (await fileFromUrl(refImage.src)));
        if (!ok) throw new Error("The model did not accept the reference image.");
      }
      if (promptDirty) await setPrompt({ prompt: promptText.trim() });
      setApplied({ prompt: promptText.trim(), refSrc: refImage.src });
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setApplying(false);
    }
  };

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
  const ready = status === "ready";
  const running = phase === "running";
  const hint = !ready
    ? status === "connecting"
      ? "Connecting…"
      : status === "waiting"
        ? "Waiting for a GPU…"
        : "Connect, then start an example."
    : busy || running
        ? "Starting…"
        : "Pick an example and press Start.";

  // The output area shows the one next step until a run is producing:
  // key → Connect → Start. The header keeps the same controls, small.
  const stepCard = (step: string, title: string, body: string, button: ReactNode) => (
    <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-950/90 p-6 shadow-xl">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{step}</span>
      <h2 className="mt-1 text-lg font-semibold tracking-tight text-zinc-100">{title}</h2>
      <p className="mt-1 text-sm text-zinc-400">{body}</p>
      <div className="mt-4">{button}</div>
    </div>
  );
  const action: ReactNode = !apiKey ? (
    <ApiKeyBar variant="panel" />
  ) : status === "disconnected" ? (
    stepCard(
      "Step 2 of 3",
      "Connect to XMAX X2.1",
      "Opens a session on a GPU. It runs on your credit until you disconnect or leave the page.",
      <Button disabled={busy} onClick={connectNow}>
        Connect
      </Button>,
    )
  ) : ready && !busy && !running ? (
    stepCard(
      "Step 3 of 3",
      `Start “${selected.titleEn}”`,
      "Pick another example on the right at any time. Once it runs, press and drag on the output.",
      <Button onClick={start}>Start</Button>,
    )
  ) : null;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-zinc-800 px-4 py-3 lg:px-6">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight">
            <a
              href="https://www.reactor.inc/models/xmax-x2-1"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-zinc-600 underline-offset-4 hover:decoration-zinc-300"
            >
              XMAX X2.1
            </a>{" "}
            Drag · Reactor template
          </h1>
          <p className="text-xs text-zinc-400">
            Drag points on a video and the generated character follows.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <ApiKeyBar />
          <ConnectBar busy={busy} onConnect={connectNow} onDisconnect={() => void leave()} />
          {running ? (
            <Button size="sm" variant="secondary" disabled={!ready || busy} onClick={() => void stop()}>
              Reset
            </Button>
          ) : (
            <Button size="sm" disabled={!ready || busy} onClick={start}>
              {busy && ready ? "Starting…" : "Start"}
            </Button>
          )}
        </div>
      </header>
      {needKey && (
        <p className="border-b border-zinc-800 px-4 py-2 text-xs text-amber-300 lg:px-6">
          Paste your Reactor API key at the top of the page first, then press Connect.
        </p>
      )}
      <main className="flex flex-1 flex-col gap-4 p-4 lg:min-h-0 lg:flex-row lg:gap-6 lg:p-6">
        <section className="flex min-h-0 flex-col lg:min-w-0 lg:flex-1">
          <Stage
            ui={ui}
            hint={hint}
            action={action}
            source={source}
            blank={blank}
            onTrack={onTrack}
            onSourceFrame={setSourceFrame}
            manual={manual}
            sentWindow={sentWindow}
            replayAspect={
              sourceFrame
                ? sourceFrame.w / sourceFrame.h
                : replay.track
                  ? replay.track.width / replay.track.height
                  : null
            }
            onDragHold={replay.hold}
          />
        </section>
        <aside className="flex w-full flex-col gap-4 lg:min-h-0 lg:w-80 lg:shrink-0 lg:overflow-y-auto">
          <Panel label="Examples">
            <div className="grid grid-cols-3 gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.id}
                  type="button"
                  disabled={busy}
                  onClick={() => choose(ex)}
                  className={cn(
                    "overflow-hidden rounded-md border text-left transition disabled:opacity-60",
                    selected.id === ex.id ? "border-brand" : "border-zinc-800 hover:border-zinc-600",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={media(ex.thumb)} alt="" className="aspect-[3/4] w-full object-cover" />
                  <span className="block px-2 py-1.5 text-xs text-zinc-200">{ex.titleEn}</span>
                </button>
              ))}
            </div>
          </Panel>
          {commandError && (
            <CommandError message={commandError} onDismiss={() => setCommandError(null)} />
          )}
          {publishError && <p className="text-xs text-red-400">Source: {publishError}</p>}
          {selected.kind === "video" && (
            <Panel label="Prompt and reference">
              <label htmlFor="prompt" className="block text-[11px] text-zinc-400">
                Prompt
              </label>
              <textarea
                id="prompt"
                rows={3}
                maxLength={1000}
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                className="mt-1 w-full resize-y rounded-md border border-zinc-700 bg-black/50 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500"
              />
              <p className="mt-3 text-[11px] text-zinc-400">Reference image</p>
              <div className="mt-1 flex items-start gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={refImage.src}
                  alt="Reference"
                  className="h-24 w-24 shrink-0 rounded-md border border-zinc-800 object-contain"
                />
                <div className="min-w-0 text-[11px] text-zinc-500">
                  <label className="inline-block cursor-pointer rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800">
                    Upload your own image
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) setRefImage({ src: URL.createObjectURL(file), file });
                      }}
                    />
                  </label>
                  {refImage.file ? (
                    <button
                      type="button"
                      className="mt-1 block underline hover:text-zinc-300"
                      onClick={() => setRefImage(defaultsOf(selected).ref)}
                    >
                      Use the example&apos;s image
                    </button>
                  ) : (
                    <p className="mt-1">The example&apos;s image.</p>
                  )}
                </div>
              </div>
              {running && (
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  disabled={applying || (!promptDirty && !refDirty)}
                  onClick={() => void applyLive()}
                >
                  {applying ? "Applying…" : "Apply"}
                </Button>
              )}
              <p className="mt-2 text-[11px] text-zinc-500">
                {running
                  ? "Apply sends a changed prompt or image to the running model without a reset."
                  : "Start sends this prompt and image, then streams the clip."}
              </p>
            </Panel>
          )}
          <DragPanel
            drag={dragSpec}
            replay={replay}
            manual={manual}
            store={sentWindow}
            running={running}
            onError={showError}
          />
        </aside>
      </main>
    </>
  );
}
