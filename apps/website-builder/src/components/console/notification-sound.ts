/* =============================================================================
 * The six signatures — LP.11, restoring N4.
 *
 * Ported note for note from `playSound` in `apps/erp/index.html`. They are
 * synthesised rather than sampled for a reason worth keeping: six audio files
 * are six network requests, six things to cache, six things to ship, and a
 * `<audio>` element that a browser refuses to play before a user gesture fails
 * SILENTLY. Web Audio is ~120 lines and no assets at all.
 *
 * WHY SIX AND NOT ONE. In a call centre nobody watches the screen — an operator
 * is on the phone with their eyes on an address. The sound is not decoration, it
 * is the channel: a ka-ching means money arrived, a siren means a colleague may
 * be marking orders confirmed without dialling, a phone trill means somebody is
 * waiting for a call back. One generic ping carries none of that and is trained
 * out within a day.
 *
 * NO DIRECTIVE, imported only from `"use client"` modules — the `row-flash.ts`
 * rule, and for the same reason: `"use client"` would make these exports client
 * REFERENCES rather than functions.
 *
 * IT NEVER THROWS. Every browser autoplay policy, every locked-down kiosk and
 * every headless test agent can refuse to give us an AudioContext. A
 * notification that fails to arrive because its sound could not play would be a
 * far worse defect than a silent notification.
 * ========================================================================== */

import type { SoundFamily } from "@/lib/platform/notify-vocab";

let context: AudioContext | null = null;

/**
 * The shared context, resumed if a browser suspended it.
 *
 * Browsers create it `suspended` until a user gesture. Resuming on every play
 * is what makes the first sound after somebody clicks anything actually audible
 * — without it the whole feature is silent for a session and looks broken.
 */
function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  if (context.state === "suspended") void context.resume();
  return context;
}

/** A tone with an attack/decay/release envelope. A raw square wave clicks. */
function tone(c: AudioContext, vol: number, freq: number, t0: number, dur: number, type: OscillatorType, peak: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  const p = Math.max(0.0002, peak * vol);
  // Exponential ramps, and never to zero: `exponentialRampToValueAtTime(0)` is
  // undefined behaviour and throws in some engines.
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(p, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(p * 0.6, t0 + dur * 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

/** A frequency glide — what makes a siren a siren rather than two beeps. */
function glide(c: AudioContext, vol: number, f1: number, f2: number, t0: number, dur: number, peak: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(f1, t0);
  o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  const p = Math.max(0.0002, peak * vol);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(p, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

/** A filtered noise burst — the cash-drawer clack. */
function noise(c: AudioContext, vol: number, t0: number, dur: number, lp: number, peak: number) {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = lp;
  const g = c.createGain();
  g.gain.value = peak * vol;
  src.connect(f);
  f.connect(g);
  g.connect(c.destination);
  src.start(t0);
}

/**
 * Play one family's signature.
 *
 * Returns nothing and swallows everything. See the header: a notification that
 * did not arrive because its sound failed is a worse defect than a silent one.
 */
export function playFamily(family: SoundFamily, volume: number): void {
  const c = ctx();
  if (!c) return;
  const v = Math.min(1, Math.max(0, volume));
  if (v === 0) return;

  try {
    const now = c.currentTime;
    switch (family) {
      case "new_order":
        // Ka-ching: bell ding, shimmer, ring tail, drawer, clack.
        tone(c, v, 1318.5, now, 0.5, "sine", 0.35);
        tone(c, v, 2637, now + 0.02, 0.35, "sine", 0.18);
        tone(c, v, 1568, now + 0.18, 0.5, "triangle", 0.28);
        noise(c, v, now + 0.28, 0.12, 900, 0.4);
        noise(c, v, now + 0.42, 0.06, 600, 0.3);
        break;
      case "abandoned":
        // Drawer clack plus two urgent beeps and a descent: something was
        // nearly a sale and is walking away.
        noise(c, v, now, 0.14, 1000, 0.45);
        tone(c, v, 987.8, now + 0.16, 0.18, "square", 0.22);
        tone(c, v, 987.8, now + 0.4, 0.18, "square", 0.22);
        glide(c, v, 880, 587.3, now + 0.62, 0.35, 0.2);
        break;
      case "assignment":
        // A gentle two-note bell. Work arrived; nothing is wrong.
        tone(c, v, 783.99, now, 0.45, "sine", 0.28);
        tone(c, v, 1046.5, now + 0.14, 0.6, "sine", 0.26);
        break;
      case "manipulation":
        // A two-tone wail, repeated. The only signature about a COLLEAGUE
        // rather than a customer, and the only one that should be unpleasant.
        glide(c, v, 700, 1500, now, 0.28, 0.28);
        glide(c, v, 1500, 700, now + 0.28, 0.28, 0.28);
        glide(c, v, 700, 1500, now + 0.56, 0.28, 0.28);
        glide(c, v, 1500, 700, now + 0.84, 0.28, 0.28);
        break;
      case "delivery":
        // A truck arriving: two short honks and a low tone.
        tone(c, v, 440, now, 0.18, "square", 0.26);
        tone(c, v, 440, now + 0.24, 0.18, "square", 0.26);
        tone(c, v, 220, now + 0.5, 0.4, "sawtooth", 0.22);
        break;
      case "followup":
        // A ringing phone: a triple trill. Somebody is waiting for a call.
        tone(c, v, 1000, now, 0.12, "sine", 0.26);
        tone(c, v, 1200, now + 0.14, 0.12, "sine", 0.26);
        tone(c, v, 1000, now + 0.28, 0.12, "sine", 0.26);
        tone(c, v, 1200, now + 0.42, 0.12, "sine", 0.26);
        break;
    }
  } catch {
    // Autoplay policy, a locked-down kiosk, a headless agent. Never fatal.
  }
}
