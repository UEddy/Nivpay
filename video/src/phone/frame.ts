/**
 * The one setting for how phone footage is framed in all three videos.
 *
 * "3d": the WebGL phone (Phone3D.tsx). Its screen shows only files that the
 * redaction step rendered into footage/_screens/ (npm run video:screens).
 * "flat": the plain device frame, redacting the recording as it renders.
 *
 * PC recordings (the explorer on the PC) keep the flat PC frame either way.
 */
export type PhoneFrame = "3d" | "flat";

export const PHONE_FRAME: PhoneFrame = "3d";
