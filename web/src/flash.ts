// A one-time notice for the next screen, e.g. "Brew saved." after the log form.
import { useEffect, useState } from 'react';

let pending: string | null = null;

export function setFlash(message: string): void {
  pending = message;
}

/** The notice left for this screen, shown once. */
export function useFlash(): string | null {
  const [message] = useState(() => pending);
  useEffect(() => {
    pending = null;
  }, []);
  return message;
}
