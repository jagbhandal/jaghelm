// The accents JagHelm offers (spec §15; Jag, 2026-10-19), in the order
// Settings → Appearance lists them (#321). This is the one list: tokens.css
// gives each accent but the default a `data-accent` block, the contrast check
// (scripts/ui-contrast.mjs) checks each one, and docs/design-system.md lists
// them. scripts/ui-tokens.test.mjs fails if any of those disagrees with it.
//
// An accent must never read as a status colour: each of its marks stays at
// least ΔE OK 0.05 from every status lamp, bar and word, in both themes
// (docs/design-system.md, rule 2). Blue, Indigo and Graphite were dropped for
// that reason.

/** The accent a `.jh-ui` root shows with no `data-accent` attribute. */
export const DEFAULT_ACCENT = 'violet';

/** Every accent: `id` is its `data-accent` value, `label` its name in Settings. */
export const ACCENTS = Object.freeze([
  Object.freeze({ id: 'violet', label: 'Violet' }),
  Object.freeze({ id: 'fuchsia', label: 'Fuchsia' }),
  Object.freeze({ id: 'cyan', label: 'Cyan' }),
]);
