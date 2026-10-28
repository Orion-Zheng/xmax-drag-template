"use client";

import { useSyncExternalStore } from "react";

// The visitor's own Reactor API key, typed into the page. It lives in this
// tab only: module memory plus sessionStorage, so a reload keeps it and
// closing the tab forgets it. It leaves the browser only as a header on the
// same-origin token request, and the server never stores it.
const STORAGE_KEY = "reactor-api-key";

let apiKey: string | null = null;
let loaded = false;
// Bumped when a key in use is replaced or removed. A session belongs to the
// token that created it, so the provider remounts on a new epoch and the old
// key's session ends. Entering the first key does not bump it.
let epoch = 0;
const listeners = new Set<() => void>();

function load(): string | null {
  if (!loaded) {
    loaded = true;
    try {
      apiKey = window.sessionStorage.getItem(STORAGE_KEY);
    } catch {
      apiKey = null;
    }
  }
  return apiKey;
}

export function getApiKey(): string | null {
  return typeof window === "undefined" ? null : load();
}

export function setApiKey(next: string | null) {
  const previous = getApiKey();
  if (previous && previous !== next) epoch += 1;
  apiKey = next;
  loaded = true;
  try {
    if (next) window.sessionStorage.setItem(STORAGE_KEY, next);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the key still works for this page load.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useApiKey(): string | null {
  return useSyncExternalStore(subscribe, getApiKey, () => null);
}

export function useApiKeyEpoch(): number {
  return useSyncExternalStore(
    subscribe,
    () => epoch,
    () => 0,
  );
}
