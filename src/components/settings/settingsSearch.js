/**
 * Settings' search (#317, spec §7): which sections a query finds, and by
 * which of their settings. A section declares its settings (its module's
 * `settings`, src/components/settings/sections/): each `{ name, words }`, the
 * name as the section's page heads it, the words its controls' names and
 * their synonyms. So "font" finds Appearance by its Font Family, and
 * "password" finds System, though neither word is in the section's name.
 *
 * A query's words are matched at the start of a word, case aside, so "ups"
 * finds nothing in "groups". A section is found when every word is in its
 * name and description together, or every word is in one of its settings
 * (its name and words together); those settings are its `hits`, named on its
 * card. An empty query finds every section, with no hits.
 */

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether a word of `text` starts with `word`: at its start, or after anything but a letter or digit. */
const startsAWord = (text, word) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${escape(word)}`, 'u').test(text);

/** The query's words, lower case. */
export function queryWords(query) {
  return String(query ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The sections `query` finds, in their order, each with `hits`: the names of
 * its settings the query found.
 *
 * @template {{ label: string, desc?: string, settings?: Array<{ name: string, words?: string }> }} S
 * @param {S[]} sections
 * @param {string} query
 * @returns {Array<S & { hits: string[] }>}
 */
export function searchSettings(sections, query) {
  const words = queryWords(query);
  if (words.length === 0) return sections.map((s) => ({ ...s, hits: [] }));
  const all = (text) => words.every((w) => startsAWord(text.toLowerCase(), w));
  const found = [];
  for (const section of sections) {
    const hits = (section.settings ?? [])
      .filter((s) => all(`${s.name} ${s.words ?? ''}`))
      .map((s) => s.name);
    if (hits.length > 0 || all(`${section.label} ${section.desc ?? ''}`)) {
      found.push({ ...section, hits });
    }
  }
  return found;
}
