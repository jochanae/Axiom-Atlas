const vibrate = (pattern: number | number[]) => {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {}
};

export const haptics = {
  tap: () => vibrate(8),
  cardConfirmed: () => vibrate([12, 50, 12]),
  nodeResolved: () => vibrate([10, 30, 20]),
};
