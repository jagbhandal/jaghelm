// The typefaces the new UI offers (spec §5.3 and §15; signed off in the mock,
// 2026-10-19), in the order Settings → Appearance lists them (#321). This is
// the one list: src/ui/fonts.css self-hosts each face, tokens.css gives each
// one but the default a `data-typeface` block, and docs/design-system.md lists
// them. scripts/fonts.test.mjs fails if any of those disagrees with it, or with
// the font file itself.
//
// Manrope is the default. Montserrat is Arcane's face: offered, never the
// default (epic #333, rule 9). Each face is two variable files from Google
// Fonts, the latin and latin-ext subsets (#394), under the SIL Open Font
// License 1.1 (src/fonts/licences/). A browser downloads only the face a screen
// renders text in, and its latin-ext file only once that text has a character
// outside latin, such as the Ł in Łódź.

/** The face a `.jh-ui` root shows with no `data-typeface` attribute. */
export const DEFAULT_TYPEFACE = 'manrope';

/**
 * Every sans face: `id` is its `data-typeface` value, `label` its name in
 * Settings, `family` its name in CSS, `file` its latin font in src/fonts/ (all a
 * latin-only screen downloads), `latinExtFile` its latin-ext font there, and
 * `weights` the weight range both files cover.
 */
export const TYPEFACES = Object.freeze([
  Object.freeze({
    id: 'manrope',
    label: 'Manrope',
    family: 'Manrope Variable',
    file: 'manrope-latin-wght.woff2',
    latinExtFile: 'manrope-latin-ext-wght.woff2',
    weights: [200, 800],
  }),
  Object.freeze({
    id: 'plus-jakarta-sans',
    label: 'Plus Jakarta Sans',
    family: 'Plus Jakarta Sans Variable',
    file: 'plus-jakarta-sans-latin-wght.woff2',
    latinExtFile: 'plus-jakarta-sans-latin-ext-wght.woff2',
    weights: [200, 800],
  }),
  Object.freeze({
    id: 'montserrat',
    label: 'Montserrat',
    family: 'Montserrat Variable',
    file: 'montserrat-latin-wght.woff2',
    latinExtFile: 'montserrat-latin-ext-wght.woff2',
    weights: [100, 900],
  }),
]);

/**
 * The one monospace face, for hostnames, SHAs, paths and code (`--font-mono`). Its
 * latin file is the one today's screens use for JetBrains Mono
 * (src/styles/fonts.css), so the two never download it twice; the new UI's
 * family name differs so that its wider weight range can't change how today's
 * screens match weights.
 */
export const MONO_TYPEFACE = Object.freeze({
  id: 'jetbrains-mono',
  label: 'JetBrains Mono',
  family: 'JetBrains Mono Variable',
  file: 'jetbrains-mono-latin-wght.woff2',
  latinExtFile: 'jetbrains-mono-latin-ext-wght.woff2',
  weights: [400, 800],
});
