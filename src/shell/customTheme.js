/**
 * The custom theme in use (#331; the validator and its rules are
 * server/themes.js). A theme is chosen like dark and light (theme.js, saved
 * per browser as `custom:<base>:<id>`) and defined in the display config's
 * `themes`, so every device has it. The validator is not in the first load:
 * it is fetched (lazyViews.js loadThemes) only when a custom theme is chosen,
 * and the page draws the theme's base, a built-in theme, until it is in.
 *
 * `useCustomTheme(config, themeState, ready)` gives the chosen theme once it
 * has passed, as `{ id, base, vars, setsAccent }` (`vars` are the custom
 * properties the shell hands every `.jh-ui` root), or null: nothing chosen, a
 * theme the config no longer has (once the server's copy is in, the choice
 * goes back to the default), one that fails the contrast rules (it stays
 * chosen, drawn as its base, and Settings → Appearance lists why it was
 * rejected), or the validator still on its way. The app keeps drawing the
 * built-in theme in every one of those cases, never a half-applied theme.
 */
import { useEffect, useState } from 'react';
import { loadThemes } from '../lazyViews.js';
import { DEFAULT_THEME, customChoice, parseCustomChoice } from './theme.js';

/** The theme `id` in the config's list as written, or undefined. */
function listed(config, id) {
  const list = Array.isArray(config?.themes) ? config.themes : [];
  return list.find((t) => t !== null && typeof t === 'object' && t.id === id);
}

export function useCustomTheme(config, { theme, setTheme }, ready) {
  const choice = parseCustomChoice(theme);
  const id = choice?.id ?? null;
  const present = id !== null && listed(config, id) !== undefined;
  // What was checked: the choice's id and the config's list as text, so a
  // renamed or edited theme is checked again and an unrelated edit is not.
  const list = present ? JSON.stringify(config.themes) : null;
  const key = list === null ? null : `${id}\n${list}`;
  const [checked, setChecked] = useState(null);

  useEffect(() => {
    if (key === null) return undefined;
    let live = true;
    (async () => {
      try {
        const { validateThemes, themeVars } = await loadThemes();
        const found = validateThemes(JSON.parse(list)).valid.find((t) => t.id === id);
        if (!live) return;
        setChecked({
          key,
          theme: found
            ? {
                id: found.id,
                base: found.base,
                setsAccent: found.setsAccent,
                vars: Object.freeze(themeVars(found.tokens)),
              }
            : null,
        });
      } catch {
        // The chunk didn't load (offline): the built-in base stays, the next load tries again.
        if (live) setChecked(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [key, id, list]);

  const active = key !== null && checked?.key === key ? checked.theme : null;

  // The config's base is the truth; the saved choice only remembers it.
  const chosenBase = choice?.base;
  useEffect(() => {
    if (active && active.base !== chosenBase) setTheme(customChoice(active.base, active.id));
  }, [active, chosenBase, setTheme]);

  // A theme the server's copy doesn't have goes back to the default.
  useEffect(() => {
    if (ready && id !== null && !present) setTheme(DEFAULT_THEME);
  }, [ready, id, present, setTheme]);

  return active;
}
