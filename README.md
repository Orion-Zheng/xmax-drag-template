# XMAX X2.1 Drag · Reactor template

Drag points on a video and the generated character follows. A one-page Next.js app for the Reactor
model [`reactor/xmax-x2-1`](https://www.reactor.inc/models/xmax-x2-1): connect, start one of three examples (two drag
examples, an anime girl and a tiger, and one video-to-video character replacement with an editable
prompt and reference image), and press and drag on the output yourself. The first example can also
replay a three-point drag.

```sh
pnpm install && pnpm dev
```

Open <http://localhost:3000>, paste your Reactor API key into the field at the top (the "Get an API
key" button shows how to create one), press Connect, and start an example. The key stays in your browser tab.

See `AGENTS.md` for how the app works and the model's docs.
