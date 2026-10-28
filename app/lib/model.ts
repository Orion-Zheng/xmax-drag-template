// The one module the app imports the model from: the typed client for
// reactor/xmax-x2-1. XmaxX21Provider fixes the model name and tracks; the hooks
// give typed commands (setPrompt, setReferenceImage, setPointers, reset, …)
// and typed messages (state_update, generation_stopped, …).
export {
  MODEL_NAME,
  XmaxX21MainVideoView,
  XmaxX21Provider,
  useXmaxX21,
  useXmaxX21GenerationStarted,
  useXmaxX21GenerationStopped,
  useXmaxX21StateUpdate,
  type XmaxX21StateUpdateMessage,
} from "@reactor-models/xmax-x2-1";

// MODEL_NAME above is "reactor/xmax-x2-1"; it must equal MODEL_NAME in
// app/api/reactor/token/route.ts, which scopes the token to this model.
export const REACTOR_API_URL = "https://api.reactor.inc";
