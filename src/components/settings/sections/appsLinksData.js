import { useEffect, useRef, useState } from 'react';
import { checkEmbedUrl } from '../../../api/embedCheck.js';

/**
 * What Settings → Apps & links (#362) works out from the display config, apart
 * from drawing it: addresses, ids, order, the Quick Launch groups as they
 * are read, and each app's embedding check.
 */

/**
 * A typed address as it is saved: "grafana.lan:3000" is https://grafana.lan:3000,
 * a scheme other than http(s) or an address with credentials is refused.
 * @param {string} text
 * @returns {{ url: string } | { error: string }}
 */
export function normalizeAddress(text) {
  const typed = String(text ?? '').trim();
  if (!typed) return { error: 'Enter the address, such as https://grafana.lan.' };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { error: 'That is not an address JagHelm can open. Try https://grafana.lan.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: 'Use an http:// or https:// address.' };
  }
  if (parsed.username || parsed.password) {
    return { error: 'Leave the user name and password out of the address.' };
  }
  return { url: withScheme };
}

/** The address as a row shows it: no scheme, no trailing slash. */
export const shortAddress = (url) =>
  String(url ?? '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');

/** A new app's id: its name as a slug, numbered when a tab already has it. */
export function newAppId(label, tabs) {
  const taken = new Set((tabs || []).map((t) => String(t?.id)));
  const base =
    String(label ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'app';
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** `list` with the item at `index` moved by `delta` places, or the same list when it can't. */
export function moved(list, index, delta) {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** `list` with the item whose id is `from` placed where the one whose id is `to` is (`idOf(item, index)`). */
export function reordered(list, idOf, from, to) {
  const a = list.findIndex((x, i) => idOf(x, i) === from);
  const b = list.findIndex((x, i) => idOf(x, i) === to);
  if (a < 0 || b < 0 || a === b) return list;
  const next = [...list];
  const [item] = next.splice(a, 1);
  next.splice(b, 0, item);
  return next;
}

/** The embedded apps, as the editor lists them: the config's `iframe` tabs, in its order. */
export const appsIn = (tabs) =>
  (Array.isArray(tabs) ? tabs : []).filter(
    (t) => t && typeof t === 'object' && t.type === 'iframe'
  );

/**
 * The Quick Launch groups as the editor lists them, all of them: `[{ key,
 * links }]` in the config's order. A group that is empty, or isn't a list, is
 * an empty group, and a link with no name or address is still a link to
 * edit, so nothing the config holds is left out of the page.
 */
export function groupsIn(links) {
  if (!links || typeof links !== 'object' || Array.isArray(links)) return [];
  return Object.entries(links).map(([key, list]) => ({
    key,
    links: (Array.isArray(list) ? list : []).map((l) => (l && typeof l === 'object' ? l : {})),
  }));
}

/** The key a new group is saved under: its name, lower case, other characters as "_". */
export const groupKey = (name) =>
  String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_');

/**
 * What a row says about an app's embedding: `{ tone, text }`, tone ok / warn /
 * neutral. `result` is checkEmbedUrl's answer, or undefined while it is asked.
 */
export function embeddingWord(app, result) {
  if (app.newTab === true) return { tone: 'neutral', text: 'Opens in a new tab' };
  if (!result) return { tone: 'neutral', text: 'Checking…' };
  if (result.verdict === 'allowed') return { tone: 'ok', text: 'Embeds fine' };
  if (result.verdict === 'blocked') {
    return {
      tone: 'warn',
      text: result.header ? `Blocks embedding (${result.header})` : 'Blocks embedding',
    };
  }
  return {
    tone: 'neutral',
    text: result.reason ? `Could not check (${result.reason})` : 'Could not check',
  };
}

/**
 * Each framed app's embedding check, by address: asked once per address when
 * the apps are listed (the server caches it), and `seed`ed with the answer
 * the add form already has. `ask` is checkEmbedUrl.
 *
 * @returns {{ results: Record<string, object>, seed: (url: string, result: object) => void }}
 */
export function useEmbeddingChecks(apps, ask = checkEmbedUrl) {
  const [results, setResults] = useState({});
  const asked = useRef(new Set());
  const mounted = useRef(true);
  const urls = apps
    .filter((a) => a.newTab !== true && typeof a.url === 'string' && a.url)
    .map((a) => a.url);
  const key = urls.join('\n');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      asked.current = new Set(); // asked again on the next mount
    };
  }, []);

  useEffect(() => {
    for (const url of key ? key.split('\n') : []) {
      if (asked.current.has(url)) continue;
      asked.current.add(url);
      ask(url).then((result) => {
        if (mounted.current) setResults((r) => ({ ...r, [url]: result }));
      });
    }
  }, [key, ask]);

  const seed = (url, result) => {
    asked.current.add(url);
    setResults((r) => ({ ...r, [url]: result }));
  };
  return { results, seed };
}
