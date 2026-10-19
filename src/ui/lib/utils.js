/**
 * `cn` joins class names and drops any utility that a later one overrides, so a
 * caller's className beats a component's own classes. The shadcn/ui registry
 * now imports it from the `cn` package directly; this re-export keeps the
 * `utils` alias in components.json working for anything that still uses it.
 */
export { cn } from 'cn';
