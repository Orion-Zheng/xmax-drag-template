import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Strict Mode mounts every effect twice in development. ReactorProvider
  // (@reactor-team/js-sdk 3.x) disposes its Reactor in an effect cleanup and
  // then disconnects that same disposed Reactor again when it swaps in a new
  // store, which throws "This Reactor was disposed" in `next dev` (and in
  // v0's preview, which runs `next dev`). Production builds are unaffected.
  reactStrictMode: false,
};

export default nextConfig;
