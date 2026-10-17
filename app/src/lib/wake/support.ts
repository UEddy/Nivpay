/** Whether this browser can listen for the wake word at all: the microphone, and an audio worklet to read it. */
export function wakeSupported(): boolean {
  return typeof window !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof AudioWorkletNode !== "undefined" && typeof AudioContext !== "undefined";
}
