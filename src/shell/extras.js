/**
 * Today's extras (#307, spec §8 "Today's extras keep a home"): the weather and
 * the clock, which the old header drew and the new shell (#296) had dropped,
 * and the web search, which moves to the Launch page. No new setting or data
 * but one: they read what Widgets had, as before (`showWeather`, the place
 * and city, `units`: Settings → Appearance since #317; `showSearch` and
 * `searchEngine`: Settings → Apps & links) and /api/weather, and
 * the clock gets a switch (`showClock`, on until switched off, as the old
 * header always drew it).
 *
 *   weatherPlace   "lat,lon" when the weather is shown and a place is set
 *   weatherReading /api/weather's answer as words: "48°F", "Overcast"
 *   useWeather     the weather as WeatherClock (@ui/utilities) draws it, read
 *                  while `active` and the browser tab shows, every 10 minutes
 *   useClock       the time, on the minute, while `active`
 *   searchEngine, webSearchUrl  where the Launch page's search goes
 */
import { useEffect, useRef, useState } from 'react';
import { useConfig } from '../context/ConfigContext.jsx';
import { usePageVisible } from '../hooks/usePageVisible.js';
import { SEARCH_ENGINES, WEATHER_CODES, getWeather } from '../hooks/useData.js';
import { slowReadOf } from './tickBudget.js';
import { formatTemperature, unitsFromConfig } from '../util/format.js';

/** How often the weather is read again, as the old header did (the server keeps it 2 minutes). */
export const WEATHER_REFRESH_MS = 10 * 60_000;
/** How soon a failed read is tried again. */
export const WEATHER_RETRY_MS = 60_000;

// A coordinate as Settings → Appearance saves it (a string), within ±limit.
function coordinate(raw, limit) {
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/**
 * The weather's place, "lat,lon", or null when there is no weather to show:
 * switched off in Settings → Appearance, or no place set (as the old header).
 */
export function weatherPlace(config) {
  if (!config || config.showWeather === false) return null;
  const lat = coordinate(config.weatherLat, 90);
  const lon = coordinate(config.weatherLon, 180);
  return lat == null || lon == null ? null : `${lat},${lon}`;
}

/** Whether the clock is shown: until Settings → Appearance switches it off. */
export const clockShown = (config) => config?.showClock !== false;

/** Whether there is weather or a clock to show: the rail and the Launch page draw a panel. */
export const extrasShown = (config) => weatherPlace(config) != null || clockShown(config);

/** Whether the Launch page has the web search: until Settings → Apps & links switches it off. */
export const searchShown = (config) => config?.showSearch !== false;

/**
 * /api/weather's answer (open-meteo's `current`, in Fahrenheit) as
 * `{ temperature, condition, code }`: "48°F" or "9°C" by Settings' units,
 * rounded; the condition's words, or null for a code it has none for. Null
 * without a temperature.
 */
export function weatherReading(body, config) {
  const f = body?.current?.temperature_2m;
  if (typeof f !== 'number' || !Number.isFinite(f)) return null;
  // The server asks open-meteo in Fahrenheit; the one `units` setting
  // (util/format.js, #322) says how it is printed.
  const code = body.current.weather_code;
  return {
    temperature: formatTemperature(f, { from: 'F', units: unitsFromConfig(config) }),
    condition: WEATHER_CODES[code]?.label ?? null,
    code: Number.isInteger(code) ? code : null,
  };
}

// The last answer, kept for the page by place, so the Overview and the Launch
// page, each reading on its own, don't ask again within 10 minutes.
let lastWeather = { place: null, at: 0, body: null };

const cached = (place) =>
  lastWeather.place === place && place != null
    ? { place, body: lastWeather.body, failed: false }
    : { place, body: null, failed: false };

/**
 * The weather as WeatherClock draws it: null when it isn't configured;
 * `{ loading, place }` until the first answer; `{ temperature, condition,
 * code, place }`; or `{ failed, place }` when no reading came (the read
 * failed, or the answer had no temperature). `place` is Settings' city, or
 * null. Read while `active` and the browser tab shows: at once (unless the
 * page read it in the last 10 minutes), then every 10 minutes; a failed read
 * is tried again a minute later, and the last reading stays meanwhile. On the
 * Overview, `tick` (the App's refresh tick) times the reads after the first:
 * once one is due, on the next tick tickBudget.js gives the weather, never
 * one that reads /api/history or the Pipeline, so a tick stays within the
 * request budget (#306). Without one (the Launch page), it keeps its own
 * clock.
 */
export function useWeather({ active = true, tick = null } = {}) {
  const { config } = useConfig();
  const place = weatherPlace(config);
  const visible = usePageVisible();
  const [read, setRead] = useState(() => cached(place));
  const on = active && visible && place != null;
  const ticked = tick != null;
  // When the next read is due, and the read itself, for the tick.
  const dueAt = useRef(0);
  const loadRef = useRef(null);

  useEffect(() => {
    if (!on) return undefined;
    let cancelled = false;
    let timer = null;
    const [lat, lon] = place.split(',');
    const load = async () => {
      let wait = WEATHER_REFRESH_MS;
      try {
        const body = await getWeather(lat, lon);
        lastWeather = { place, at: Date.now(), body };
        if (!cancelled) setRead({ place, body, failed: false });
      } catch {
        wait = WEATHER_RETRY_MS;
        if (!cancelled)
          setRead((was) => ({
            place,
            body: was.place === place ? was.body : null,
            failed: true,
          }));
      }
      dueAt.current = Date.now() + wait;
      if (!cancelled && !ticked) timer = setTimeout(load, wait);
    };
    loadRef.current = load;
    const age = lastWeather.place === place ? Date.now() - lastWeather.at : Infinity;
    dueAt.current = Date.now() + WEATHER_REFRESH_MS - age;
    if (age >= WEATHER_REFRESH_MS) load();
    else if (!ticked) timer = setTimeout(load, WEATHER_REFRESH_MS - age);
    return () => {
      cancelled = true;
      loadRef.current = null;
      clearTimeout(timer);
    };
  }, [on, place, ticked]);

  // On the App's tick: a read once due, on a weather tick.
  const lastTick = useRef(tick);
  useEffect(() => {
    if (!ticked || tick === lastTick.current) return;
    lastTick.current = tick;
    if (slowReadOf(tick) === 'weather' && Date.now() >= dueAt.current) loadRef.current?.();
  }, [ticked, tick]);

  if (place == null) return null;
  const shown = read.place === place ? read : cached(place);
  const city = String(config?.weatherCity ?? '').trim() || null;
  const reading = weatherReading(shown.body, config);
  if (reading) return { ...reading, place: city };
  if (shown.failed || shown.body != null) return { failed: true, place: city };
  return { loading: true, place: city };
}

/**
 * The time, in ms, moved on at each minute (the clock shows minutes), and at
 * once when the browser tab is shown again; still while not `active`.
 */
export function useClock(active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    let timer = null;
    const tick = () => {
      clearTimeout(timer);
      const at = Date.now();
      setNow(at);
      timer = setTimeout(tick, 60_000 - (at % 60_000) + 20);
    };
    const shown = () => {
      if (!document.hidden) tick();
    };
    tick();
    document.addEventListener('visibilitychange', shown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', shown);
    };
  }, [active]);
  return now;
}

/** The search engine Settings → Apps & links names, or Google. */
export function searchEngine(config) {
  return SEARCH_ENGINES.find((s) => s.id === config?.searchEngine) ?? SEARCH_ENGINES[0];
}

/** The engine's results page for `words`. */
export function webSearchUrl(engine, words) {
  return engine.url + encodeURIComponent(words);
}
