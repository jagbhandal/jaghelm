import { paletteIndex, paletteSearch } from '../shell/paletteIndex.js';
import { SEARCHABLE_SECTIONS } from './settings/sectionTerms.js';

/**
 * What ⌘K's palette finds (#315, #611): the chunk CommandPalette.jsx loads
 * when the palette first opens, or once the browser is idle. Everything it
 * indexes is here and not in the first load: the rows (paletteIndex.js), the
 * search over them, and Settings' sections with their search terms
 * (settings/sectionTerms.js).
 *
 *   paletteGroups   paletteIndex.js's groups, with Settings' sections and their
 *                   search terms
 *   paletteSearch   the groups a query matches (paletteIndex.js)
 */
export const paletteGroups = (options) =>
  paletteIndex({ ...options, sections: SEARCHABLE_SECTIONS });

export { paletteSearch };
