"use client";

import dynamic from "next/dynamic";
import { ApiKeyBar } from "./components/ApiKeyBar";

// The session part is client-only: it drives WebRTC and reads the key from
// sessionStorage. The header, with the key field, renders on the server too,
// so the page is never blank and never blocked on a key.
const DragSession = dynamic(() => import("./DragSession").then((m) => m.DragSession), {
  ssr: false,
});

export default function Page() {
  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3 lg:px-6">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight">X2.1 Drag · Reactor template</h1>
          <p className="text-xs text-zinc-400">
            Drag points on a video and the generated character follows.
          </p>
        </div>
        <ApiKeyBar />
      </header>
      <DragSession />
    </div>
  );
}
