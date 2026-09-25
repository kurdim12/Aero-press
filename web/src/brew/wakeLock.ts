// Keep the screen on while a brew runs. Browsers drop the lock when the page is hidden,
// so it's taken again when the page comes back.

let sentinel: WakeLockSentinel | null = null;
let pending: Promise<void> | null = null;
let wanted = false;

export function holdScreenOn(): Promise<void> {
  wanted = true;
  if (sentinel || pending || !('wakeLock' in navigator) || document.visibilityState !== 'visible') {
    return pending ?? Promise.resolve();
  }
  pending = navigator.wakeLock
    .request('screen')
    .then((lock) => {
      sentinel = lock;
      lock.addEventListener('release', () => {
        if (sentinel === lock) sentinel = null;
      });
      if (!wanted) void lock.release();
    })
    .catch(() => {
      // Not allowed (low battery, no https) or unsupported: the timer still works.
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export async function releaseScreen(): Promise<void> {
  wanted = false;
  const lock = sentinel;
  sentinel = null;
  try {
    await lock?.release();
  } catch {
    // Already released.
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible') void holdScreenOn();
  });
}
