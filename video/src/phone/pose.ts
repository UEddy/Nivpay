/**
 * How the phone frame moves: a slow float and tilt, and face-on and still
 * whenever a viewer has to read something. Shared by the 3D phone and its CSS
 * 3D fallback, so both move the same way. Pure, so it is tested.
 */

export type Pose = { rotX: number; rotY: number; lift: number };

export const AT_REST: Pose = { rotX: 0, rotY: 0, lift: 0 };

/** Largest tilt and float, in radians and in phone heights. Restrained on purpose. */
export const MOTION = { rotY: 0.12, rotX: 0.05, lift: 0.02 };

/** Seconds to ease into and out of motion, so every segment starts and ends face-on. */
export const EASE_SECONDS = 1.5;

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/**
 * The pose at `frame` of a segment `frames` long. A segment marked `still`
 * (an amount or "Settled in" on screen) is face-on and motionless throughout;
 * any other segment eases in from face-on and back to face-on at its end, so
 * cuts between segments never jump.
 */
export function poseAt(frame: number, frames: number, fps: number, still: boolean, phase = 0): Pose {
  if (still) return AT_REST;
  const t = frame / fps;
  const ease = EASE_SECONDS * fps;
  const amp = Math.min(smooth(frame / ease), smooth((frames - frame) / ease));
  return {
    rotY: amp * MOTION.rotY * Math.sin((2 * Math.PI * t) / 7 + phase),
    rotX: amp * MOTION.rotX * Math.sin((2 * Math.PI * t) / 9 + 1 + phase),
    lift: amp * MOTION.lift * Math.sin((2 * Math.PI * t) / 5 + phase),
  };
}

/**
 * A push-in on the screen as a texture window: the part of the recording
 * shown at `scale` (1 to 3) around the origin x, y (fractions from the top
 * left). The same crop the flat frame makes with a CSS scale, so the
 * recording is scaled, never redrawn.
 */
export function zoomWindow(scale: number, x: number, y: number): { repeat: number; offsetX: number; offsetY: number } {
  const s = Math.max(1, scale);
  const repeat = 1 / s;
  // Texture rows run bottom to top, so a window near the top has a high offset.
  return { repeat, offsetX: x * (1 - repeat), offsetY: (1 - y) * (1 - repeat) };
}
