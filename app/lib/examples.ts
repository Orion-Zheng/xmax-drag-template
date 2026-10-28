// The examples, one list (examples.json), two kinds:
//   drag   a starting image, streamed into the model as a still `source` and
//          also sent as the reference image, plus a recorded pointer
//          trajectory that can be replayed over it. Media in
//          public/ex/drag/<id>/ (reference.jpg, thumb.jpg, track.json).
//   video  video-to-video: the visitor's webcam (default) or the example's
//          looping clip streamed as the `source`, a prompt and a reference
//          image, both editable on the page. Media in public/ex/video/<id>/
//          (source.mp4, reference.jpg, thumb.jpg).
import data from "./examples.json";

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

interface BaseExample {
  id: string;
  titleEn: string;
  /** Sent with set_prompt; "" is valid. */
  prompt: string;
  /** Card image. Display only. */
  thumb: string;
  /** Reference images; the first is uploaded. */
  refs: string[];
}

export interface DragExample extends BaseExample {
  kind: "drag";
  drag: DragSpec;
}

export interface VideoExample extends BaseExample {
  kind: "video";
  video: {
    /** The example clip, streamed (looping) as the `source` when Webcam is not used. */
    source: string;
  };
}

export type Example = DragExample | VideoExample;

export const EXAMPLES = data.examples as Example[];

/** Media paths in examples.json are relative to public/ex/. */
export const media = (p: string) => `/ex/${p}`;
