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

Until a run is producing, the output area shows the one next step, large: paste the API key (with
"See how to get one" opening the step-by-step guide) → Connect → Start the selected example
(`DragSession.tsx`, `action`; `ApiKeyBar` with `variant="panel"`). The header keeps the same
controls, small.

**Connect** in the header opens the session (`app/DragSession.tsx`, `connectNow`): with no key
entered it shows a line asking for one and does not connect; otherwise it connects and waits for
status `ready`. Examples can be started only while connected. The header has one button that switches
between **Start** and **Reset**; the example cards only choose which example Start runs (the first is
selected on load, and picking another while one runs switches to it). Start runs (`run`):

1. Cover the output, close the drag gate (no hand drag or replay tick can be sent until step 5),
   stop any replay and hand drag, take the current source off the wire and stop the camera (see
   "Reset hygiene" and "Switching and the output cover").
2. If this run sent any drag, `setPointers({ frames: [[], [], [], []] })` to clear the points; then
   `reset`, and wait for a `state_update` with no prompt, no reference, empty `pointers` and
   `generating: false`.
3. Start this run's source and wait until that exact track is on the wire, so no frame of the
   previous source feeds the new run:
   - **drag** example: its image as a still: the example's starting image (`refs[0]`), or the
     visitor's upload. `ImageSource` fetches it to a `blob:` URL (so the canvas is never
     cross-origin tainted), draws it to a canvas (long side at most 1280, sides floored to multiples
     of 4) and publishes `canvas.captureStream(24)`, repainting the same frame at 24 fps.
   - **video** example on **Webcam** (the default): `WebcamSource` asks for the camera
     (`getUserMedia`) only now, never on page load. Denied permission, no camera or a busy camera
     fails the Start with a readable message and an "Use the example clip" link. The self-view is
     mirrored; the published track is not.
   - **video** example on **Example clip**: the clip, muted and looping. `VideoSource` fetches it to
     a `blob:` URL (`captureStream()` refuses a cross-origin clip; it falls back to
     `crossOrigin="anonymous"`) and publishes the `<video>`'s `captureStream()`.
4. Upload the reference image (`uploadFile`, cropped to multiples of 4 first) and
   `setReferenceImage` with it: for a drag example the same image as the source; for a video example
   the one shown in its panel (the visitor's upload, if any).
5. Arm the output cover and open the drag gate.
6. `setPrompt`: the example's prompt for a drag example (`""` is valid and still starts generation),
   the text in the panel for a video example. Generation starts here.

A **drag** example's Image panel has "Upload your own image" and "Use the example's image". The
chosen image is both the streamed still and the reference. Before Start it only changes what Start
uses; while running, **Restart with this image** runs the whole sequence again, because the source
changes. The recorded multi-point drag belongs to the example's own image, so with an uploaded image
it is hidden (with a one-line note); hand drag works on any image.

A **video** example's panel has a **Webcam | Example clip** toggle, a Prompt box (prefilled with the
example's prompt) and a Reference image with "Upload your own image". Switching the toggle while
running swaps the source live, without a reset (switching to Webcam starts the camera then). While
it runs, **Apply** sends what changed without a reset: a new image through the same upload +
`setReferenceImage` path, a new prompt with `setPrompt`; both apply from the model's next block. The
camera stops on Reset, on a switch to another example, on Disconnect and when the page goes.

### Reset hygiene

Every Start, switch and Reset goes through the same reset (`cleanReset` in `DragSession.tsx`):
- **Drag gate** (`createPointerGate` in `app/lib/pointerFrames.ts`): every `setPointers` from the
  hand drag (`useManualDrag`) and the replay (`useDragReplay`) checks it. It closes the moment a
  reset begins and opens only when the new run is armed, so nothing reaches the model in between.
  The gate also records whether this run sent any drag; if so, four empty frames are sent before
  `reset`.
- **Clean** means no prompt, no reference image, empty `pointers` and not generating, from the
  `state_update` that ends the model's reset.

### Seeing what the model holds: `?debug=1`

Open the page with `?debug=1` (for example `http://localhost:3000/?debug=1`). The browser console
then shows, prefixed `[x21]` and timestamped, every command the page sends (name and a short
summary: point counts and the newest points for `setPointers`, the prompt's first 80 characters,
file name and size for uploads; never a key or token) and every `state_update` (generating, prompt,
reference, `pointers`, output size), `generation_started` and `generation_stopped` it receives. Use
it to tell a leftover on the model (it shows in `state_update`) from a leftover on the page.
Implemented in `app/lib/model.ts` (`useXmaxX21` wrapper, `useDebugLog`); without the flag the hook is
the package's own, unchanged.

### Switching and the output cover

The output `<video>` keeps showing the last frame it received, and state updates from a run that is
being reset keep saying `generating: true` until the model has processed the reset. So the moment a
Start, a switch to another example, or Reset begins, the output is covered (the example's image,
dimmed, with "Starting…") and the source is unpublished. The cover is armed only after the clean
post-reset `state_update`; after that, the first `generation_started` or generating `state_update`
lifts it, and the stage still waits for the output's next presented frame
(`requestVideoFrameCallback`) before showing it. The previous example's output is never shown.

No drag is sent on Start. The person drags on the output by hand. For a multi-point example the
Drag panel offers **Try multi-point drag**, which replays the recorded `track.json` with
`setPointers`; it is never on by default. A **Replay speed** slider (0.1× to 1.5×, 0.75× on load) scales the replay clock; changing it
mid-replay keeps the position (`DragReplay.tsx`, `DEFAULT_REPLAY_SPEED`). When no multi-point example is running, the panel
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
| `app/lib/model.ts` | The only import of the model package (`@reactor-models/xmax-x2-1`); the `?debug=1` log |
| `app/lib/examples.ts`, `app/lib/examples.json` | One example list, `kind`: `drag` or `video`; media in `public/ex/drag/<id>/` and `public/ex/video/<id>/` |
| `app/lib/pointerFrames.ts` | `set_pointers` window helpers, the shared "last sent" store, the drag gate |
| `app/components/DragReplay.tsx` | Replays a recorded track over the still on a 24 fps clock; Drag panel |
| `app/components/useManualDrag.ts` | Turns pointer samples on the output into 24 fps windows |
| `app/components/PointerOverlay.tsx` | Captures the drag on the output and draws the sent points |
| `app/components/Stage.tsx` | Output view, the output cover, and the source inset |
| `app/components/ImageSource.tsx`, `VideoSource.tsx`, `WebcamSource.tsx` | Produce the `source` track from a still image, a looping clip or the webcam |
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

- **Add an example** to `app/lib/examples.json`: a drag example (`kind: "drag"`) needs
  `reference.jpg` (the starting image, used as both source and reference), `thumb.jpg` and
  `track.json` in `public/ex/drag/<id>/`; a video example (`kind: "video"`) needs `source.mp4`
  (H.264, no audio, a few MB), `reference.jpg` and `thumb.jpg` in `public/ex/video/<id>/`.
- **Record your own track**: log the manual drag's per-frame points (`useManualDrag`) from the
  moment it starts at 24 fps, with the still's size as `width`/`height`, and save them in the `track.json` format above.
- **Multiple points by hand**: track several active pointers (multi-touch) in `PointerOverlay` and
  put one point per finger in each frame list (up to 8).
- **Change how the trail is drawn**: `PointerOverlay.tsx` draws the last window (older frames
  fainter, newest as a ring).
- **Let the visitor bring their own clip** for the video example: feed a picked file's blob URL to
  `VideoSource` as a third source option.
- A different layout or visual style.

## Checking your work

- `pnpm build` must pass.
- With no key entered, the whole app still renders; Connect asks for the key, and Start stays
  disabled until connected.
- With a key: Connect (Connecting → Connected), Start an example, the output starts with no drag.
  Press and drag on the output to steer. On the anime example, Try multi-point drag replays the
  recorded three-point drag; your own drag pauses it while held. Reset (the same button once the example runs) clears the model. On the video example,
  edit the prompt or upload an image and press Apply while it runs; switching examples while running
  must never show the previous example's output. The video example asks for the camera on Start
  (the default Webcam source); without a camera, pick Example clip. No microphone is needed. Add
  `?debug=1` to watch the commands and the model's state in the console.
