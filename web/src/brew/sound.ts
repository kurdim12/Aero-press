// Beep and vibrate at each brew step. Audio has to be unlocked by a tap (Start does it).

let ctx: AudioContext | null = null;

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/** Call from a tap. On iPhone this also lets beeps play with the silent switch on. */
export function unlockAudio(): void {
  try {
    const nav = navigator as AudioSessionNavigator;
    if (nav.audioSession) nav.audioSession.type = 'playback';
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    // No audio on this device; vibration may still work.
  }
}

function tone(audio: AudioContext, frequency: number, at: number, seconds: number): void {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.45, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  osc.connect(gain).connect(audio.destination);
  osc.start(at);
  osc.stop(at + seconds + 0.05);
}

/** One beep for a new step, a rising double beep when the brew is done. */
export function beep(kind: 'step' | 'done'): void {
  try {
    navigator.vibrate?.(kind === 'done' ? [180, 90, 180] : 250);
  } catch {
    // Vibration is best-effort.
  }
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const now = ctx.currentTime;
  if (kind === 'step') tone(ctx, 880, now, 0.3);
  else {
    tone(ctx, 660, now, 0.25);
    tone(ctx, 990, now + 0.3, 0.4);
  }
}

// After a reload mid-brew, the next tap anywhere turns sound back on.
if (typeof window !== 'undefined') window.addEventListener('pointerdown', unlockAudio, { once: true });
