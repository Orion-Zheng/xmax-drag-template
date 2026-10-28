# XMAX X2.1 Drag · Reactor template

Drag points on a video and the generated character follows. A one-page Next.js app for the Reactor
model [`reactor/xmax-x2-1`](https://github.com/reactor-team/create-reactor-app/tree/main/templates/xmax-x2-1): connect, start one of three examples (two drag
examples, an anime girl and a tiger, and one video-to-video character replacement on your webcam or an example clip, with an
editable prompt and reference image), and press and drag on the output yourself. Drag examples take
your own image too, and the first one can replay a three-point drag. Add `?debug=1` to log what the
page sends and what the model reports in the browser console.

```sh
pnpm install && pnpm dev
```

Open <http://localhost:3000>, paste your Reactor API key into the field at the top (the "Get an API
key" button shows how to create one), press Connect, and start an example. The key stays in your browser tab.

See `AGENTS.md` for how the app works and the model's docs.
