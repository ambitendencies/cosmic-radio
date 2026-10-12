// Generated stereo impulse response: decorrelated noise with an exponential
// decay that gets darker over time (high frequencies die first, like a real
// hall). No sample files needed.

export function createImpulseResponse(ctx, { seconds = 6, decay = 2.6, preDelay = 0.02, darkening = 0.9 } = {}) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  const pre = Math.floor(rate * preDelay);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let lp = 0;
    let seed = ch ? 0x9e3779b9 : 0x7f4a7c15;
    for (let i = pre; i < length; i++) {
      // xorshift noise: fast and deterministic.
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const white = ((seed >>> 0) / 4294967296) * 2 - 1;
      const t = (i - pre) / length;
      // One-pole low-pass whose coefficient rises over the tail.
      const k = 0.15 + darkening * 0.8 * t;
      lp = lp * k + white * (1 - k);
      const env = Math.pow(1 - t, decay) * (1 - Math.exp(-(i - pre) / (rate * 0.01)));
      data[i] = lp * env * (1 + k); // compensate for level lost to filtering
    }
  }
  return buffer;
}
