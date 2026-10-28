"use client";

import { useEffect, useState, type FormEvent } from "react";
import { setApiKey, useApiKey } from "../lib/api-key";
import { mintToken } from "../lib/token";

const KEYS_URL = "https://www.reactor.inc/account/api-keys";

// The API key field, inline in the header; the rest of the app is usable
// around it. Submitting mints one token with the key, so a mistyped key is
// caught here rather than on the first call; that token is then reused.
export function ApiKeyBar() {
  const apiKey = useApiKey();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = value.trim();
    if (!key) return;
    setChecking(true);
    setError(null);
    try {
      await mintToken(key);
      setApiKey(key);
      setValue("");
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  const guideButton = (
    <button
      type="button"
      onClick={() => setGuideOpen(true)}
      className="shrink-0 text-xs text-zinc-400 underline hover:text-zinc-200"
    >
      Get an API key
    </button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {apiKey && !editing ? (
        <div className="flex items-center gap-3 text-xs">
          <span className="text-zinc-400">
            API key{" "}
            <span className="font-mono text-zinc-200">…{apiKey.slice(-4)}</span>
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-zinc-400 underline hover:text-zinc-200"
          >
            Change
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <label htmlFor="reactor-api-key" className="sr-only">
            Reactor API key
          </label>
          <input
            id="reactor-api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your Reactor API key"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-56 min-w-0 rounded-md border border-zinc-700 bg-black/50 px-3 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-zinc-500"
          />
          <button
            type="submit"
            disabled={checking || !value.trim()}
            className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-fg disabled:opacity-50"
          >
            {checking ? "Checking…" : "Use key"}
          </button>
          {apiKey && (
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setValue("");
                setError(null);
              }}
              className="shrink-0 text-xs text-zinc-400 underline hover:text-zinc-200"
            >
              Cancel
            </button>
          )}
          {guideButton}
        </form>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {guideOpen && <KeyGuide onClose={() => setGuideOpen(false)} />}
    </div>
  );
}

function KeyGuide({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="key-guide-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id="key-guide-title"
            className="text-base font-semibold tracking-tight"
          >
            Get a Reactor API key
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-zinc-500 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
        <ol className="mt-4 space-y-3 text-sm text-zinc-300">
          <Step n={1}>
            Sign in at{" "}
            <a
              href="https://www.reactor.inc"
              target="_blank"
              rel="noreferrer"
              className="text-brand underline"
            >
              reactor.inc
            </a>
            , or create an account.
          </Step>
          <Step n={2}>
            Open{" "}
            <a
              href={KEYS_URL}
              target="_blank"
              rel="noreferrer"
              className="text-brand underline"
            >
              Account → API keys
            </a>
            .
          </Step>
          <Step n={3}>
            Click <strong>Create key</strong>, give it a name (for example
            “My app”), choose its roles, and create it.
          </Step>
          <Step n={4}>
            Copy the key right away. It is shown only once.
          </Step>
          <Step n={5}>
            Paste it into the API key field at the top of this page and press{" "}
            <strong>Use key</strong>.
          </Step>
        </ol>
        <p className="mt-4 text-xs text-zinc-500">
          Calls in this app spend that account&apos;s Reactor credit. The key
          stays in this browser tab and is only used to start your sessions.
        </p>
        <a
          href={KEYS_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-block rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-fg"
        >
          Open API keys
        </a>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="font-mono text-zinc-500">{n}.</span>
      <span>{children}</span>
    </li>
  );
}
