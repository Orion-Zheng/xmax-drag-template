// The UI's projection of the model's session, reduced from the `state_update`
// snapshot the model broadcasts on connect and after every observable state
// change; the model is the source of truth. The drag pointer is deliberately
// not here: it changes every frame of a drag, so only the components that
// draw it subscribe to it (see components/DragReplay).
export interface UiState {
  /** Whether a generation run is currently producing `main_video` frames. */
  generating: boolean;
  /** The active editing instruction, or null when none is set. */
  activePrompt: string | null;
  /** Output resolution, fixed for the session once the first run starts. */
  outputWidth: number | null;
  outputHeight: number | null;
  /** Whether a reference image is currently conditioning generation. */
  hasReference: boolean;
  /** Last reference_image_accepted ack ({width, height} of the decoded image). */
  referenceAccepted: { width: number; height: number } | null;
}

export const DEFAULT_UI_STATE: UiState = {
  generating: false,
  activePrompt: null,
  outputWidth: null,
  outputHeight: null,
  hasReference: false,
  referenceAccepted: null,
};
