import type { Piece } from "./redactions.ts";

export const FPS = 30;

/** Frames for each piece of a timeline, rounded so pieces never overlap. */
export const pieceFrames = (p: Piece) => Math.max(1, Math.round((p.kind === "clip" ? p.to - p.from : p.seconds) * FPS));
