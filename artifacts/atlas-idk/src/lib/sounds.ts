let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    return ctx;
  } catch { return null; }
}

function tone(frequency: number, duration: number, volume = 0.08, type: OscillatorType = "sine") {
  const ac = getCtx();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + duration);
}

export const sounds = {
  tap: () => tone(660, 0.06, 0.06),
  cardConfirmed: () => {
    tone(523, 0.08, 0.07);
    setTimeout(() => tone(659, 0.10, 0.07), 80);
  },
  nodeResolved: () => {
    tone(440, 0.06, 0.06);
    setTimeout(() => tone(554, 0.08, 0.07), 70);
    setTimeout(() => tone(659, 0.10, 0.07), 140);
  },
};
