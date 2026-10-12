// Look-ahead scheduler ("A Tale of Two Clocks"): a coarse timer wakes up
// often and schedules every 16th note that falls inside the look-ahead
// window, timed sample-accurately against the AudioContext clock.
// The timer lives in a Worker so background tabs don't throttle it.

const WORKER_SRC = `let id=null;onmessage=(e)=>{if(e.data==='start'){clearInterval(id);id=setInterval(()=>postMessage('tick'),25);}else{clearInterval(id);id=null;}};`;

export class Scheduler {
  constructor(ctx, { tempo = 72, lookAhead = 0.15, stepsPerBeat = 4 } = {}) {
    this.ctx = ctx;
    this.tempo = tempo;
    this.targetTempo = tempo;
    this.lookAhead = lookAhead;
    this.stepsPerBeat = stepsPerBeat;
    this.step = 0;
    this.nextTime = 0;
    this.listeners = new Set();
    this.running = false;
    this.timer = null;
  }

  get secondsPerStep() {
    return 60 / this.tempo / this.stepsPerBeat;
  }

  setTempo(bpm) {
    this.targetTempo = bpm;
  }

  onStep(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.nextTime = this.ctx.currentTime + 0.1;
    const tick = () => this.pump();
    try {
      const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
      this.worker = new Worker(url);
      URL.revokeObjectURL(url);
      this.worker.onmessage = tick;
      this.worker.postMessage('start');
    } catch {
      this.timer = setInterval(tick, 25);
    }
  }

  stop() {
    this.running = false;
    this.worker?.postMessage('stop');
    this.worker?.terminate();
    this.worker = null;
    clearInterval(this.timer);
  }

  pump() {
    if (!this.running) return;
    // If we fell far behind (tab suspended), skip ahead rather than burst.
    if (this.nextTime < this.ctx.currentTime - 0.5) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.nextTime < this.ctx.currentTime + this.lookAhead) {
      // Glide tempo by ~0.5% per step, so changes feel like breathing, not a jump.
      this.tempo += (this.targetTempo - this.tempo) * 0.02;
      const info = {
        step: this.step,
        bar: Math.floor(this.step / (this.stepsPerBeat * 4)),
        beat: Math.floor(this.step / this.stepsPerBeat) % 4,
        stepInBar: this.step % (this.stepsPerBeat * 4),
        secondsPerStep: this.secondsPerStep,
        tempo: this.tempo,
      };
      for (const fn of this.listeners) {
        try {
          fn(this.nextTime, info);
        } catch (err) {
          console.error('[scheduler] listener failed', err);
        }
      }
      this.nextTime += this.secondsPerStep;
      this.step++;
    }
  }
}
