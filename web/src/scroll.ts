import { useEffect } from 'react';
import { useLocation } from 'wouter';

// Where the last Back/Forward went. Registered before wouter subscribes, so it is set before
// the screen changes.
let poppedTo: string | null = null;
window.addEventListener('popstate', () => {
  poppedTo = window.location.pathname;
});

/** New screens open at the top; Back and Forward keep the browser's own scroll restore. */
export function useScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    const restoring = poppedTo === location;
    poppedTo = null;
    if (!restoring) window.scrollTo(0, 0);
  }, [location]);
}
