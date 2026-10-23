/*
 * useWidth(ref): an element's own width, measured as it resizes, or null
 * until it has one (no layout, as in a test). A section that draws a table
 * only when it has the room for one (InfrastructureSection, ServicesSection)
 * reads it.
 */
import { useLayoutEffect, useState } from 'react';

export function useWidth(ref) {
  const [width, setWidth] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      setWidth(w > 0 ? w : null);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
