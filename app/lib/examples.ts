// The drag examples. Each one is a starting image, streamed into the model as
// a still `source` and also sent as the reference image, plus a recorded
// pointer trajectory that can be replayed over it. Metadata lives in
// drag.json; the media in public/ex/drag/<id>/ (reference.jpg, thumb.jpg,
// track.json).
import drag from "./drag.json";

export interface DragSpec {
  /** track.json: { fps, width, height, frames: [[[x, y], ...] per frame] }. */
  track: string;
  /** Most points on any frame. */
  points: number;
  fps: number;
  frames: number;
}

export interface DragTrack {
  fps: number;
  /** Size of the frame the points were recorded in. */
  width: number;
  height: number;
  /** Per source frame: pointer positions, normalised 0..1; [] = no drag. */
  frames: [number, number][][];
}

export interface DragExample {
  id: string;
  titleEn: string;
  /** Sent with set_prompt; "" is valid (the trajectory is the condition). */
  prompt: string;
  /** Card image. Display only. */
  thumb: string;
  /** Reference images; the first is uploaded. */
  refs: string[];
  drag: DragSpec;
}

export const EXAMPLES: DragExample[] = drag.examples;

/** Media paths in drag.json are relative to public/ex/. */
export const media = (p: string) => `/ex/${p}`;
