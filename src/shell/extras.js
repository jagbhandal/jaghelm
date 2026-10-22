/**
 * Today's extras (#307, spec §8 "Today's extras keep a home"): the weather and
 * the clock, which the old header drew and the new shell (#296) had dropped,
 * and the web search, which moves to the Launch page. No new setting or data
 * but one: they read Settings → Widgets as before (`showWeather`, the place
 * and city, `tempUnit`; `showSearch` and `searchEngine`) and /api/weather, and
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
import { useEffect, useState } from 'react';
import { useConfig } from '../context/ConfigContext.jsx';
import { usePageVisible } from '../hooks/usePageVisible.js';
import { SEARCH_ENGINES, WEATHER_CODES, getWeather } from '../hooks/useData.js';

/** How often the weather is read again, as the old header did (the server keeps it 2 minutes). */
export const WEATHER_REFRESH_MS = 10 * 60_000;
/** How soon a failed read is tried again. */
export const WEATHER_RETRY_MS = 60_000;

// A coordinate as Settings → Widgets saves it (a string), within ±limit.
function coordinate(raw, limit) {
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/**
 * The weather's place, "lat,lon", or null when there is no weather to show:
 * switched off in Settings → Widgets, or no place set (as the old header).
 */
export function weatherPlace(config) {
  if (!config || config.showWeather === false) return null;
  const lat = coordinate(config.weatherLat, 90);
  const lon = coordinate(config.weatherLon, 180);
  return lat == null || lon == null ? null : `${lat},${lon}`;
}

/** Whether the clock is shown: until Settings → Widgets switches it off. */
export const clockShown = (config) => config?.showClock !== false;

/** Whether there is weather or a clock to show: the rail and the Launch page draw a panel. */
export const extrasShown = (config) => weatherPlace(config) != null || clockShown(config);

/** Whether the Launch page has the web search: until Settings → Widgets switches it off. */
export const searchShown = (config) => config?.showSearch !== false;

/**
 * /api/weather's answer (open-meteo's `current`, in Fahrenheit) as
 * `{ temperature, condition, code }`: "48°F" or "9°C" by Settings' unit,
 * rounded; the condition's words, or null for a code it has none for. Null
 * without a temperature.
 */
export function weatherReading(body, config) {
  const f = body?.current?.temperature_2m;
  if (typeof f !== 'number' || !Number.isFinite(f)) return null;
  const unit = config?.tempUnit === 'C' ? 'C' : 'F';
  const degrees = Math.round(unit === 'C' ? ((f - 32) * 5) / 9 : f);
  const code = body.current.weather_code;
  return {
    temperature: `${degrees === 0 ? 0 : degrees}°${unit}`,
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
 * is tried again a minute later, and the last reading stays meanwhile.
 */
export function useWeather({ active = true } = {}) {
  const { config } = useConfig();
  const place = weatherPlace(config);
  const visible = usePageVisible();
  const [read, setRead] = useState(() => cached(place));
  const on = active && visible && place != null;

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
      if (!cancelled) timer = setTimeout(load, wait);
    };
    const age = lastWeather.place === place ? Date.now() - lastWeather.at : Infinity;
    if (age < WEATHER_REFRESH_MS) timer = setTimeout(load, WEATHER_REFRESH_MS - age);
    else load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [on, place]);

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

/** The search engine Settings → Widgets names, or Google. */
export function searchEngine(config) {
  return SEARCH_ENGINES.find((s) => s.id === config?.searchEngine) ?? SEARCH_ENGINES[0];
}

/** The engine's results page for `words`. */
export function webSearchUrl(engine, words) {
  return engine.url + encodeURIComponent(words);
}
