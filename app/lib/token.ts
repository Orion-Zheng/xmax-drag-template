"use client";

import { getApiKey } from "./api-key";

// The memoized token resolver handed to the model provider's `jwtToken` prop.
//
// The token is memoized in module scope, not the browser's HTTP cache (the
// route is no-store). A session can only be operated by the exact token
// that created it, and the SDK calls the resolver again on every later hop
// the session makes — so the resolver must return the SAME token for the
// token's whole life, and only re-mint close to expiry. A token belongs to
// the key that minted it, so a different key starts over.
const TOKEN_REFRESH_SKEW_MS = 60_000;
let cachedToken: { key: string; jwt: string; expiresAtMs: number } | null =
  null;
let inflightToken: { key: string; promise: Promise<string> } | null = null;

export function mintToken(key: string): Promise<string> {
  if (
    cachedToken &&
    cachedToken.key === key &&
    Date.now() < cachedToken.expiresAtMs - TOKEN_REFRESH_SKEW_MS
  ) {
    return Promise.resolve(cachedToken.jwt);
  }
  if (inflightToken?.key === key) return inflightToken.promise; // coalesce parallel hops
  const promise = (async () => {
    try {
      const r = await fetch("/api/reactor/token", {
        method: "POST",
        cache: "no-store",
        headers: { "Reactor-API-Key": key },
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Token fetch failed: ${r.status}`);
      }
      const { jwt, expires_at } = (await r.json()) as {
        jwt: string;
        expires_at: number;
      };
      cachedToken = { key, jwt, expiresAtMs: expires_at * 1000 };
      return jwt;
    } finally {
      inflightToken = null;
    }
  })();
  inflightToken = { key, promise };
  return promise;
}

export function fetchToken(): Promise<string> {
  const key = getApiKey();
  if (!key) return Promise.reject(new Error("Enter your Reactor API key first."));
  return mintToken(key);
}
