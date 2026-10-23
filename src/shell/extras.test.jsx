import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getWeather } from '../hooks/useData.js';
import { ConfigProvider } from '../context/ConfigContext.jsx';
import {
  WEATHER_REFRESH_MS,
  WEATHER_RETRY_MS,
  clockShown,
  searchEngine,
  searchShown,
  useClock,
  useWeather,
  weatherPlace,
  weatherReading,
  webSearchUrl,
} from './extras.js';

vi.mock('../hooks/useData.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getWeather: vi.fn(),
}));

// The weather as /api/weather answers it: open-meteo's, in Fahrenheit.
const answer = (temperature_2m, weather_code = 3) => ({
  current: { temperature_2m, weather_code },
});

beforeEach(() => {
  vi.clearAllMocks();
  getWeather.mockResolvedValue(answer(48.2));
});

afterEach(() => {
  vi.useRealTimers();
});

// #307: weather and the clock come back (the rail, the Launch page), and the
// web search (the Launch page), on today's settings and today's /api/weather.
describe('when each extra is configured', () => {
  it('weather: shown in Settings and a place set, as the old header had it', () => {
    const at = { weatherLat: '43.65', weatherLon: '-79.38' };
    expect(weatherPlace(at)).toBe('43.65,-79.38');
    expect(weatherPlace({ ...at, showWeather: true })).toBe('43.65,-79.38');
    expect(weatherPlace({ ...at, showWeather: false })).toBeNull();
    expect(weatherPlace({ showWeather: true })).toBeNull();
    expect(weatherPlace({ showWeather: true, weatherLat: '43.65', weatherLon: ' ' })).toBeNull();
    expect(weatherPlace({ weatherLat: '0', weatherLon: '0' })).toBe('0,0');
    // A place no server would take (Settings refuses to save one) is none.
    expect(weatherPlace({ weatherLat: '91', weatherLon: '0' })).toBeNull();
    expect(weatherPlace({ weatherLat: 'north', weatherLon: '0' })).toBeNull();
    expect(weatherPlace(null)).toBeNull();
  });

  it('the clock: on until switched off, as the old header always drew it', () => {
    expect(clockShown({})).toBe(true);
    expect(clockShown(null)).toBe(true);
    expect(clockShown({ showClock: true })).toBe(true);
    expect(clockShown({ showClock: false })).toBe(false);
  });

  it('the web search: on until switched off', () => {
    expect(searchShown({})).toBe(true);
    expect(searchShown({ showSearch: false })).toBe(false);
  });
});

describe('weatherReading', () => {
  it('says the temperature in the unit Settings asks for, rounded, with the condition', () => {
    expect(weatherReading(answer(48.2), {})).toEqual({
      temperature: '48°F',
      condition: 'Overcast',
      code: 3,
    });
    expect(weatherReading(answer(48.2), { tempUnit: 'C' })).toEqual({
      temperature: '9°C',
      condition: 'Overcast',
      code: 3,
    });
    expect(weatherReading(answer(31.5, 0), { tempUnit: 'C' }).temperature).toBe('0°C');
    expect(weatherReading(answer(26.6, 0), { tempUnit: 'C' }).temperature).toBe('-3°C');
  });

  it('leaves out a condition it has no words for', () => {
    expect(weatherReading(answer(70, 99), {})).toEqual({
      temperature: '70°F',
      condition: null,
      code: 99,
    });
  });

  it('is no reading without a temperature (the demo answers {})', () => {
    expect(weatherReading({}, {})).toBeNull();
    expect(weatherReading(null, {})).toBeNull();
    expect(weatherReading({ current: { temperature_2m: 'warm' } }, {})).toBeNull();
  });
});

describe('the web search', () => {
  it('uses the engine Settings names, Google by default or for one it doesn’t know', () => {
    expect(searchEngine({ searchEngine: 'duckduckgo' }).name).toBe('DuckDuckGo');
    expect(searchEngine({}).name).toBe('Google');
    expect(searchEngine({ searchEngine: 'altavista' }).name).toBe('Google');
  });

  it('builds the engine’s address with the words encoded', () => {
    expect(webSearchUrl(searchEngine({ searchEngine: 'startpage' }), 'zfs & scrub?')).toBe(
      'https://www.startpage.com/search?query=zfs%20%26%20scrub%3F'
    );
  });
});

/** useWeather with `config`, active or not. */
function renderWeather(config, { active = true } = {}) {
  let current = config;
  const wrapper = ({ children }) => (
    <ConfigProvider config={current} setConfig={() => {}}>
      {children}
    </ConfigProvider>
  );
  const view = renderHook((props) => useWeather(props), {
    wrapper,
    initialProps: { active },
  });
  return {
    ...view,
    setConfig(next) {
      current = next;
      view.rerender({ active });
    },
  };
}

// Each test uses its own place: the last reading is kept for the page, by place.
const PLACE = (lat) => ({ showWeather: true, weatherLat: String(lat), weatherLon: '-79.38' });

describe('useWeather', () => {
  it('asks for nothing and shows nothing while the weather isn’t configured', async () => {
    const { result } = renderWeather({ showWeather: false, weatherLat: '1', weatherLon: '1' });
    expect(result.current).toBeNull();
    await act(async () => {});
    expect(getWeather).not.toHaveBeenCalled();
  });

  it('reads the place’s weather, a placeholder until it comes, with the city', async () => {
    const { result } = renderWeather({ ...PLACE(10), weatherCity: ' Toronto ' });
    expect(result.current).toEqual({ loading: true, place: 'Toronto' });
    await waitFor(() =>
      expect(result.current).toEqual({
        temperature: '48°F',
        condition: 'Overcast',
        code: 3,
        place: 'Toronto',
      })
    );
    expect(getWeather).toHaveBeenCalledExactlyOnceWith('10', '-79.38');
  });

  it('says when a reading never came, and keeps the last one through a failure', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getWeather.mockRejectedValueOnce(new Error('HTTP 502'));
    const { result } = renderWeather(PLACE(11));
    await waitFor(() => expect(result.current).toEqual({ failed: true, place: null }));
    // A failed read is tried again a minute later.
    await act(() => vi.advanceTimersByTimeAsync(WEATHER_RETRY_MS));
    await waitFor(() => expect(result.current.temperature).toBe('48°F'));
    getWeather.mockRejectedValueOnce(new Error('HTTP 502'));
    await act(() => vi.advanceTimersByTimeAsync(WEATHER_REFRESH_MS));
    expect(getWeather).toHaveBeenCalledTimes(3);
    expect(result.current.temperature).toBe('48°F');
  });

  it('an answer with no temperature is no reading', async () => {
    getWeather.mockResolvedValueOnce({});
    const { result } = renderWeather(PLACE(12));
    await waitFor(() => expect(result.current).toEqual({ failed: true, place: null }));
  });

  it('reads again every 10 minutes while active, and not at all while not', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result, rerender } = renderWeather(PLACE(13));
    await waitFor(() => expect(result.current.temperature).toBe('48°F'));
    getWeather.mockResolvedValue(answer(60, 0));
    await act(() => vi.advanceTimersByTimeAsync(WEATHER_REFRESH_MS - 1000));
    expect(getWeather).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await waitFor(() => expect(result.current.condition).toBe('Clear'));
    expect(getWeather).toHaveBeenCalledTimes(2);
    rerender({ active: false });
    await act(() => vi.advanceTimersByTimeAsync(3 * WEATHER_REFRESH_MS));
    expect(getWeather).toHaveBeenCalledTimes(2);
  });

  it('a page drawn again within 10 minutes shows the last reading without asking', async () => {
    const first = renderWeather(PLACE(14));
    await waitFor(() => expect(first.result.current.temperature).toBe('48°F'));
    first.unmount();
    const again = renderWeather(PLACE(14));
    expect(again.result.current.temperature).toBe('48°F');
    await act(async () => {});
    expect(getWeather).toHaveBeenCalledTimes(1);
  });

  it('a new place reads its own weather at once', async () => {
    const view = renderWeather(PLACE(15));
    await waitFor(() => expect(view.result.current.temperature).toBe('48°F'));
    getWeather.mockResolvedValue(answer(20, 71));
    view.setConfig(PLACE(16));
    expect(view.result.current).toEqual({ loading: true, place: null });
    await waitFor(() => expect(view.result.current.condition).toBe('Light Snow'));
    expect(getWeather).toHaveBeenLastCalledWith('16', '-79.38');
  });
});

// On the Overview the App's tick times it (#306, tickBudget.js): no clock of
// its own, and once its 10 minutes (or a failure's minute) are up, it reads
// on the next tick no other slow read takes (3, 6, 9 …), so no tick asks for
// more than 4.
describe('useWeather on the App’s tick', () => {
  function renderTicked(config) {
    const wrapper = ({ children }) => (
      <ConfigProvider config={config} setConfig={() => {}}>
        {children}
      </ConfigProvider>
    );
    return renderHook((props) => useWeather(props), { wrapper, initialProps: { tick: 0 } });
  }

  it('reads at once, then, once due, only on a weather tick; never on its own clock', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result, rerender } = renderTicked(PLACE(30));
    await waitFor(() => expect(result.current.temperature).toBe('48°F'));
    expect(getWeather).toHaveBeenCalledTimes(1);
    // Its own clock would have read by now.
    await act(() => vi.advanceTimersByTimeAsync(WEATHER_REFRESH_MS + 60_000));
    expect(getWeather).toHaveBeenCalledTimes(1);
    // Due: ticks 1 and 2 belong to history and the Pipeline; 3 reads it.
    for (const tick of [1, 2]) {
      rerender({ tick });
      await act(async () => {});
      expect(getWeather, `tick ${tick}`).toHaveBeenCalledTimes(1);
    }
    rerender({ tick: 3 });
    await act(async () => {});
    expect(getWeather).toHaveBeenCalledTimes(2);
    // Not due again for 10 minutes, whatever ticks come.
    for (const tick of [4, 5, 6, 9]) {
      rerender({ tick });
      await act(async () => {});
    }
    expect(getWeather).toHaveBeenCalledTimes(2);
  });

  it('a failed read is tried again on the first weather tick a minute later', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getWeather.mockRejectedValueOnce(new Error('HTTP 502'));
    const { result, rerender } = renderTicked(PLACE(31));
    await waitFor(() => expect(result.current).toEqual({ failed: true, place: null }));
    rerender({ tick: 3 });
    await act(async () => {});
    expect(getWeather).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(WEATHER_RETRY_MS));
    rerender({ tick: 4 });
    await act(async () => {});
    expect(getWeather).toHaveBeenCalledTimes(1);
    rerender({ tick: 6 });
    await waitFor(() => expect(result.current.temperature).toBe('48°F'));
    expect(getWeather).toHaveBeenCalledTimes(2);
  });
});

describe('useClock', () => {
  it('ticks on the minute, and holds still while not active', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-22T08:41:30Z'));
    const { result, rerender } = renderHook((active) => useClock(active), { initialProps: true });
    expect(result.current).toBe(Date.parse('2026-10-22T08:41:30Z'));
    await act(() => vi.advanceTimersByTimeAsync(29_000));
    expect(result.current).toBe(Date.parse('2026-10-22T08:41:30Z'));
    await act(() => vi.advanceTimersByTimeAsync(1_100));
    expect(new Date(result.current).getUTCMinutes()).toBe(42);
    rerender(false);
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(new Date(result.current).getUTCMinutes()).toBe(42);
  });
});
