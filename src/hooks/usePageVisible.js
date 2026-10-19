/**
 * usePageVisible — whether the browser tab is showing (Page Visibility API), so
 * polling can stop while nobody can see the page.
 */

import { useState, useEffect } from 'react';

export function usePageVisible() {
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}
