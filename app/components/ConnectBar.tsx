"use client";

import { useXmaxX21 } from "../lib/model";
import { Button, cn } from "./ui";

// Connection state and the one explicit Connect / Disconnect control, in the
// header. A connected session holds a GPU and spends credit until it ends.
const TONE: Record<string, { dot: string; label: string }> = {
  disconnected: { dot: "bg-zinc-500", label: "Disconnected" },
  connecting: { dot: "bg-blue-500 animate-pulse", label: "Connecting…" },
  waiting: { dot: "bg-blue-500 animate-pulse", label: "Waiting for a GPU…" },
  ready: { dot: "bg-active animate-pulse", label: "Connected" },
};

export function ConnectBar({
  busy,
  onConnect,
  onDisconnect,
}: {
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const { status } = useXmaxX21();
  const tone = TONE[status] ?? TONE.disconnected;
  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center gap-2 text-xs text-zinc-300">
        <span className={cn("h-2 w-2 rounded-full", tone.dot)} />
        {tone.label}
      </span>
      {status === "disconnected" ? (
        <Button size="sm" disabled={busy} onClick={onConnect}>
          Connect
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={onDisconnect}>
          Disconnect
        </Button>
      )}
    </div>
  );
}
