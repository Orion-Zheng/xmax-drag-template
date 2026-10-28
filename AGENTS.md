# Working on this app

This is a Next.js app for **XMax X2.1** (`reactor/xmax-x2-1`), a Reactor model that edits a live
video stream: here, you drag points on the output and the generated character follows them. The
person you are working with wants to change it: add a feature, restyle it, or turn it into their own
product. Keep it working while you do.

## Read before you change anything

1. This file, in full: how the app drives the model and the rules that silently break a session.
2. The model's reference, when you need more. Fetch the Markdown pages directly; never guess a
   command or field:
   - Overview: <https://docs.reactor.inc/model-api-reference/xmax-x2-1/overview.md>
   - Schema (every command, message and track):
     <https://docs.reactor.inc/model-api-reference/xmax-x2-1/schema.md>
   - Tutorial: <https://docs.reactor.inc/model-api-reference/xmax-x2-1/tutorial.md>
   - Prompt guide: <https://docs.reactor.inc/model-api-reference/xmax-x2-1/prompt-guide.md>
   - Index of all Reactor docs: <https://docs.reactor.inc/llms.txt>
3. The Reactor docs MCP server, `https://docs.reactor.inc/mcp` (no authentication), searches all of
   the above. If it is not connected and the person asks for something the pages above do not
   answer, tell them once how to add it: chat **+** menu → MCPs → add a custom server with that URL.

## How the app drives the model

**Connect** in the header opens the session (`app/DragSession.tsx`, `connectNow`): with no key
entered it shows a line asking for one and does not connect; otherwise it connects and waits for
status `ready`. Examples can be started only while connected. The header has one button that switches
between **Start** and **Reset**; the example cards only choose which example Start runs (the first is
selected on load, and picking another while one runs switches to it). Start runs (`run`):

1. `reset`, then wait for a `state_update` with no prompt, no reference and `generating: false`.
2. Upload the example's reference image (`uploadFile`) and `setReferenceImage` with it.
3. `setPrompt` with the example's prompt (`""` is valid and still starts generation).
4. The example's starting image (`refs[0]`, the same image as the reference) is streamed as a still
   on the `source` track: `ImageSource` fetches it to a `blob:` URL (so the canvas is never
   cross-origin tainted), draws it to a canvas (long side at most 1280, sides floored to multiples
   of 4) and publishes `canvas.captureStream(24)`, repainting the same frame at 24 fps. No video is
   needed. Publishing is held back until step 1 confirmed, so no frame meets the previous session's
   state.

No drag is sent on Start. The person drags on the output by hand. For a multi-point example the
Drag panel offers **Try multi-point drag**, which replays the recorded `track.json` with
`setPointers`; it is never on by default. When no multi-point example is running, the panel
suggests trying it on the first example (the anime girl).

Reset sends `reset`. Disconnect resets (if running) and ends the session. Leaving the page does the
same, so the GPU is freed at once.

### The drag wire format (`set_pointers`)

- Payload: `{ frames: [f0, f1, f2, f3] }`, exactly **4 frames per call**, oldest to newest. The
  model generates in 4-frame blocks and reads the latest window once per block.
- Each frame is a list of **0 to 8 points** `{ x, y }`, **normalised 0..1 to the output frame**,
  origin top-left. Several points steer several parts at once (one list entry per point).
- An **empty list = no drag** on that frame. **Clear = four empty frames**
  (`setPointers({ frames: [[], [], [], []] })`).
- The app runs its own clock at **24 fps**: every frame tick it sends the last 4 frames' points, so
  a block always finds the 4 latest positions (`app/lib/pointerFrames.ts`).
- **Replay over a still is timed by a clock**: frame = floor(elapsed × fps) modulo the track
  length, counted from when the replay starts, and the window of the last 4 frames is sent whenever
  the frame changes.
- Output size arrives in `state_update` (`width`, `height`) once a run starts. A recorded point is
  first placed in the still's frame (the recording is treated as the still fitted to its size), then
  mapped into the output frame with the same fit the server applies to the source (`fitPoints` in
  `app/components/DragReplay.tsx`); nothing is sent before the size is known.
- `track.json` (per example): `{ fps, width, height, frames: [[[x, y], ...] per source frame] }`,
  points normalised to the frame they were recorded in (`width` x `height`), `[]` = no drag.

## Which file does what

| File | What it does |
|---|---|
| `app/page.tsx` | Header (title, API key field) and the client-only session below it |
| `app/DragSession.tsx` | Provider, header (key, Connect, Start / Reset), example cards, the start sequence |
| `app/lib/model.ts` | The only import of the model package (`@reactor-models/xmax-x2-1`) |
| `app/lib/examples.ts`, `app/lib/drag.json` | Example list and types; media in `public/ex/drag/<id>/` |
| `app/lib/pointerFrames.ts` | `set_pointers` window helpers and the shared "last sent" store |
| `app/components/DragReplay.tsx` | Replays a recorded track over the still on a 24 fps clock; Drag panel |
| `app/components/useManualDrag.ts` | Turns pointer samples on the output into 24 fps windows |
| `app/components/PointerOverlay.tsx` | Captures the drag on the output and draws the sent points |
| `app/components/Stage.tsx`, `ImageSource.tsx` | Output view, source image inset and its still track |
| `app/components/useSourcePublisher.ts` | The single owner of `publish("source", track)` |
| `app/lib/reference.ts` | Reference upload (crops to multiples of 4 first) |
| `app/lib/api-key.ts`, `app/lib/token.ts`, `app/components/ApiKeyBar.tsx` | Visitor's key, token cache, key field and "Get an API key" panel |
| `app/api/reactor/token/route.ts` | Mints a short-lived token scoped to this model from the visitor's key |

## Rules that keep the app working

- **Each visitor enters their own API key.** It lives in `app/lib/api-key.ts` (this tab only) and
  is sent only as a header to `app/api/reactor/token/route.ts`, which uses it for one mint. Never
  log it, store it on the server, put it in a URL, or hard-code a key into the app.
- **The page never blocks on the key.** Everything renders without one; check `getApiKey()` before
  anything connects and show a line asking for the key instead.
- **The provider is keyed on `useApiKeyEpoch()`**, so replacing the key ends the old key's session.
- **Import the model only from `app/lib/model.ts`**, and read the store through its typed hook
  `useXmaxX21` (status, commands, `publish`). Do not use the base SDK's `useReactor`.
- **Keep `MODEL_NAME` in the token route equal to the provider's model** (`reactor/xmax-x2-1`). A
  token scoped to another model mints fine and then fails on connect.
- **Keep `reactStrictMode: false`** in `next.config.ts` (see the comment there).
- **Reset and wait for the clean `state_update` before publishing the source.** The model keeps
  prompt and reference across sessions.
- **One publisher for `source`** (`useSourcePublisher`); switching examples republishes, never races.
- Keep reference images at sides that are multiples of 4 (`app/lib/reference.ts` does this).

## Ideas the person may ask for

- **Add an example**: put `reference.jpg` (the starting image, used as both source and reference), `thumb.jpg`
  and `track.json` in
  `public/ex/drag/<id>/` and add an entry to `app/lib/drag.json`.
- **Record your own track**: log the manual drag's per-frame points (`useManualDrag`) from the
  moment it starts at 24 fps, with the still's size as `width`/`height`, and save them in the `track.json` format above.
- **Multiple points by hand**: track several active pointers (multi-touch) in `PointerOverlay` and
  put one point per finger in each frame list (up to 8).
- **Change how the trail is drawn**: `PointerOverlay.tsx` draws the last window (older frames
  fainter, newest as a ring).
- **Let the visitor upload their own image**: feed its URL to `ImageSource` as the source
  and the same `File` to `useReferenceUpload().apply` as the reference.
- A different layout or visual style.

## Checking your work

- `pnpm build` must pass.
- With no key entered, the whole app still renders; Connect asks for the key, and Start stays
  disabled until connected.
- With a key: Connect (Connecting → Connected), Start an example, the output starts with no drag.
  Press and drag on the output to steer. On the anime example, Try multi-point drag replays the
  recorded three-point drag; your own drag pauses it while held. Reset (the same button once the example runs) clears the model. No camera or
  microphone is needed.
