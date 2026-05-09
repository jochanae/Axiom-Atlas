import { useCallback, useRef } from "react";

let _ctx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!_ctx) _ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (_ctx.state === "suspended") _ctx.resume();
    return _ctx;
  } catch {
    return null;
  }
}

function haptic(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch {}
}

function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = "sine",
  gain = 0.18,
  fadeOut = true,
  startDelay = 0,
) {
  const ctx = getCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ctx.currentTime + startDelay);
  gainNode.gain.setValueAtTime(gain, ctx.currentTime + startDelay);
  if (fadeOut) gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startDelay + duration);
  osc.start(ctx.currentTime + startDelay);
  osc.stop(ctx.currentTime + startDelay + duration + 0.01);
}

export function useSound(enabled = true) {
  const mutedRef = useRef(false);
  try {
    const stored = localStorage.getItem("axiom-sound");
    if (stored === "off") mutedRef.current = true;
  } catch {}

  const isMuted = !enabled || mutedRef.current;

  const playSend = useCallback(() => {
    if (isMuted) return;
    playTone(880, 0.06, "sine", 0.10);
    playTone(1100, 0.08, "sine", 0.07, true, 0.04);
    haptic(8);
  }, [isMuted]);

  const playCatch = useCallback(() => {
    if (isMuted) return;
    playTone(220, 0.12, "triangle", 0.22);
    playTone(330, 0.12, "triangle", 0.18, true, 0.10);
    playTone(440, 0.20, "triangle", 0.14, true, 0.20);
    haptic([20, 50, 20]);
  }, [isMuted]);

  const playCommit = useCallback(() => {
    if (isMuted) return;
    playTone(523.25, 0.10, "sine", 0.13);
    playTone(659.25, 0.10, "sine", 0.12, true, 0.09);
    playTone(783.99, 0.18, "sine", 0.10, true, 0.18);
    haptic([10, 30, 10]);
  }, [isMuted]);

  const playPark = useCallback(() => {
    if (isMuted) return;
    playTone(440, 0.14, "sine", 0.10);
    playTone(330, 0.16, "sine", 0.08, true, 0.12);
    haptic(6);
  }, [isMuted]);

  const playNavigate = useCallback(() => {
    if (isMuted) return;
    playTone(660, 0.05, "sine", 0.08);
    haptic(4);
  }, [isMuted]);

  const playError = useCallback(() => {
    if (isMuted) return;
    playTone(180, 0.18, "sawtooth", 0.12);
    haptic([30, 60, 30]);
  }, [isMuted]);

  return { playSend, playCatch, playCommit, playPark, playNavigate, playError };
}
