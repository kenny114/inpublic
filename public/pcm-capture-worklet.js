class InPublicPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkFrames = Math.max(128, Math.round(sampleRate * 0.08));
    this.buffer = new Int16Array(this.chunkFrames);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      this.buffer[this.offset] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.offset += 1;

      if (this.offset === this.chunkFrames) {
        const chunk = this.buffer;
        this.port.postMessage(chunk.buffer, [chunk.buffer]);
        this.buffer = new Int16Array(this.chunkFrames);
        this.offset = 0;
      }
    }

    return true;
  }
}

registerProcessor("inpublic-pcm-capture", InPublicPcmCapture);
