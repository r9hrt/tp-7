// Generative ambient pad — no external file, no license worries.
// A handful of detuned sine voices through a slow-LFO low-pass filter
// gives a soft, evolving "studio idle" tone, in line with TE's synth DNA.

export function createAmbientPad() {
  let ctx = null;
  let master = null;
  let filter = null;
  let lfo = null;
  let lfoGain = null;
  let voices = [];
  let started = false;

  // Low, hollow chord — Cmin9-ish without the third (open + drone-y)
  const VOICES_HZ = [55, 82.5, 110, 165, 247.5];

  async function start() {
    if (started) return;
    started = true;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctx();
    if (ctx.state === "suspended") await ctx.resume();

    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 380;
    filter.Q.value = 0.6;
    filter.connect(master);

    // Slow LFO modulating the filter cutoff (breathing motion)
    lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    voices = VOICES_HZ.map((hz, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = hz;
      osc.detune.value = (i - 2) * 4;

      const g = ctx.createGain();
      g.gain.value = 0.18 / VOICES_HZ.length;

      // Per-voice tremolo, slightly different rate for each → drift
      const trem = ctx.createOscillator();
      trem.frequency.value = 0.12 + i * 0.05;
      const tremGain = ctx.createGain();
      tremGain.gain.value = 0.04;
      trem.connect(tremGain).connect(g.gain);
      trem.start();

      osc.connect(g).connect(filter);
      osc.start();

      return { osc, g, trem };
    });

    // Fade in
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(0.55, now + 1.6);
  }

  function stop() {
    if (!started || !ctx) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0, now + 0.6);
    setTimeout(() => {
      try {
        voices.forEach((v) => {
          v.osc.stop();
          v.trem.stop();
        });
        lfo.stop();
        ctx.close();
      } catch (_) {}
      ctx = null;
      voices = [];
      started = false;
    }, 700);
  }

  // Smoothly ramp master volume to `value` (0–1) over ~150 ms.
  // Safe to call at any time — no-op when the pad is not running.
  function setGain(value) {
    if (!ctx || !master) return;
    const v = Math.max(0, Math.min(1, value));
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(v, now + 0.15);
  }

  return { start, stop, setGain };
}
