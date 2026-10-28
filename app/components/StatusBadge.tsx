"use client";

import { MODEL_NAME, useXmaxX21 } from "../lib/model";
import { Button, Panel, cn } from "./ui";

// Connection state (disconnected -> connecting -> waiting -> ready). Picking
// an example connects; Disconnect ends the session and frees the GPU.
const TONE: Record<string, { dot: string; label: string }> = {
  disconnected: { dot: "bg-zinc-500", label: "Disconnected" },
  connecting: { dot: "bg-blue-500 animate-pulse", label: "Connecting…" },
  waiting: { dot: "bg-blue-500 animate-pulse", label: "Waiting for a GPU…" },
  ready: { dot: "bg-active animate-pulse", label: "Connected" },
};

export function StatusBadge({ onDisconnect }: { onDisconnect: () => void }) {
  const { status, lastError } = useXmaxX21();
  const tone = TONE[status] ?? TONE.disconnected;

  return (
    <Panel>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", tone.dot)} />
          <span className="text-sm text-zinc-200">{tone.label}</span>
        </div>
        {status !== "disconnected" && (
          <Button variant="secondary" size="sm" onClick={onDisconnect}>
            Disconnect
          </Button>
        )}
      </div>
      <p className="mt-1 truncate font-mono text-[11px] text-zinc-500">{MODEL_NAME}</p>
      {lastError && status !== "disconnected" && (
        <p className="mt-2 text-xs text-red-400">{lastError.message}</p>
      )}
    </Panel>
  );
}
