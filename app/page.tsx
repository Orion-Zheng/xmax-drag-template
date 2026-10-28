"use client";

import dynamic from "next/dynamic";

// The whole page is client-only: it drives WebRTC and reads the key from
// sessionStorage. While it loads, the same header shell shows, so the page is
// never blank.
const DragSession = dynamic(() => import("./DragSession").then((m) => m.DragSession), {
  ssr: false,
  loading: () => (
    <header className="border-b border-zinc-800 px-4 py-3 lg:px-6">
      <h1 className="text-base font-semibold tracking-tight">XMAX X2.1 Drag · Reactor template</h1>
    </header>
  ),
});

export default function Page() {
  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <DragSession />
    </div>
  );
}
