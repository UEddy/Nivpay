// NivPay's "Hey NivPay" listener: the microphone's samples, handed to the
// page about 12 times a second, where the wake word engine reads them
// (src/lib/wake/engine.ts). Nothing here sends anything anywhere: the page is
// the only thing that hears it, and the page sends nothing until the wake
// word is heard. Plain JavaScript, loaded as an audio worklet.

class NivPayCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4096);
    this.len = 0;
  }

  process(inputs, outputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.len++] = ch[i];
        if (this.len === this.buf.length) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(4096);
          this.len = 0;
        }
      }
    }
    // Silence out: the node is joined to the speakers only so the browser keeps running it.
    if (outputs[0] && outputs[0][0]) outputs[0][0].fill(0);
    return true;
  }
}

registerProcessor("nivpay-capture", NivPayCapture);
