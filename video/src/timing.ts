import type { Piece } from "./redactions.ts";

export const FPS = 30;

/** Frames for each piece of a timeline, rounded so pieces never overlap. Footage runs at `speed`; a hold never does. */
export const pieceFrames = (p: Piece, speed = 1) => Math.max(1, Math.round((p.kind === "clip" ? (p.to - p.from) / speed : p.seconds) * FPS));
