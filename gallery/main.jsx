/*
 * The component gallery (#289, docs/GALLERY.md): every state in catalog.js,
 * drawn by states.jsx, in both themes and both densities, and in the three
 * accents where colour follows the accent. A development and CI page only: its
 * own Vite entry (vite.gallery.config.js), which the production build never
 * includes (scripts/gallery-build.test.mjs).
 *
 *   /gallery/                   every state; an isolated one in a frame
 *   /gallery/?state=<variant>   one variant alone, as the tests shoot it
 *   /gallery/?theme=light&density=compact&accent=cyan&group=Data   a subset
 *
 * It loads the stylesheets as src/main.jsx does, unchanged, so a component
 * looks here as it will on a screen. Once a variant has rendered, its fonts
 * have loaded, its focus is set and what it waits for is in the page, the
 * page sets `data-gallery-ready` on <html> ("true", or "timeout" with the
 * reason logged as an error).
 */
import '../src/styles/legacy.css';
import '@ui/tailwind.css';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { UiRoot } from '@ui/root';
import {
  ACCENTS,
  CATALOG,
  DENSITIES,
  READY_ATTRIBUTE,
  STATE_ATTRIBUTE,
  THEMES,
  VARIANTS,
  variantById,
} from './catalog.js';
import { RENDERS } from './states.jsx';

/** The faces a state can draw in, loaded before it is shot (all self-hosted). */
const FACES = ['400 14px "Manrope Variable"', '400 14px "JetBrains Mono Variable"'];
const WAIT_MS = 5000;

const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

async function until(check, ms) {
  const end = performance.now() + ms;
  while (!check()) {
    if (performance.now() > end) return false;
    await frame();
  }
  return true;
}

/** Marks the page ready once `variant` (or the whole gallery) has settled. */
async function settle(variant) {
  const html = document.documentElement;
  await Promise.all(FACES.map((face) => document.fonts.load(face)));
  await document.fonts.ready;
  // A state opened under the pointer waits for it in the tests, after the hover.
  const { focus, hover, wait: waits = {} } = variant?.state ?? {};
  const wait = hover ? {} : waits;
  if (focus) {
    const el = document.querySelector(focus);
    if (!el) {
      console.error(`gallery: ${variant.id} has nothing to focus at ${focus}`);
      return html.setAttribute(READY_ATTRIBUTE, 'timeout');
    }
    el.focus({ focusVisible: true });
  }
  const missing = () =>
    Object.entries(wait).filter(([selector, n]) => document.querySelectorAll(selector).length < n);
  if (!(await until(() => missing().length === 0, WAIT_MS))) {
    console.error(
      `gallery: ${variant.id} is still waiting for ${missing()
        .map(([s]) => s)
        .join(', ')}`
    );
    return html.setAttribute(READY_ATTRIBUTE, 'timeout');
  }
  await document.fonts.ready;
  await frame();
  await frame();
  html.setAttribute(READY_ATTRIBUTE, 'true');
}

function Settle({ variant }) {
  useEffect(() => {
    settle(variant);
  }, [variant]);
  return null;
}

/** One variant in its own UiRoot, the element its screenshot is taken of. */
function StateRoot({ variant, fill = false }) {
  const Render = RENDERS[variant.state.id];
  return (
    <UiRoot
      id={variant.id}
      {...{ [STATE_ATTRIBUTE]: variant.state.id }}
      theme={variant.theme}
      density={variant.density}
      accent={variant.accent}
      style={fill ? { padding: 48, minHeight: '100vh' } : { padding: 24 }}
    >
      <Render />
    </UiRoot>
  );
}

/** ?state=<variant>: that variant alone, as the tests shoot it. */
function StatePage({ variant }) {
  return (
    <main>
      <h1 className="sr-only">{`${variant.state.title} (${variant.id})`}</h1>
      <StateRoot variant={variant} fill={Boolean(variant.state.isolated)} />
      <Settle variant={variant} />
    </main>
  );
}

const muted = { color: 'var(--jh-text-2)' };
const link = { color: 'var(--jh-accent-text)' };

function FilterLinks({ name, values, params }) {
  return (
    <p style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      <span style={muted}>{name}:</span>
      {['all', ...values].map((value) => {
        const next = new URLSearchParams(params);
        if (value === 'all') next.delete(name);
        else next.set(name, value);
        const current = (params.get(name) ?? 'all') === value;
        return (
          <a
            key={value}
            href={`?${next}`}
            aria-current={current || undefined}
            style={{ ...link, fontWeight: current ? 700 : 400 }}
          >
            {value}
          </a>
        );
      })}
    </p>
  );
}

/** Every state, grouped as the design system lists them. */
function IndexPage({ params }) {
  const keep = (v) =>
    ['theme', 'density', 'accent'].every((k) => !params.get(k) || params.get(k) === v[k]) &&
    (!params.get('group') || params.get('group') === v.state.group);
  const groups = [...new Set(CATALOG.map((s) => s.group))];
  return (
    <UiRoot>
      <main style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 32 }}>
        <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h1 style={{ fontSize: 28, lineHeight: '32px', fontWeight: 800 }}>Component gallery</h1>
          <p style={muted}>
            Every state of every src/ui component, in each theme, density and accent it is checked
            in. CI screenshots each one and runs axe on it (docs/GALLERY.md). Open a variant&apos;s
            name to see it alone.
          </p>
          <FilterLinks name="theme" values={THEMES} params={params} />
          <FilterLinks name="density" values={DENSITIES} params={params} />
          <FilterLinks name="accent" values={ACCENTS} params={params} />
          <FilterLinks name="group" values={groups} params={params} />
        </header>
        {groups.map((group) => (
          <section key={group} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <h2 style={{ fontSize: 20, lineHeight: '26px', fontWeight: 700 }}>{group}</h2>
            {CATALOG.filter((s) => s.group === group).map((state) => {
              const variants = VARIANTS.filter((v) => v.state === state && keep(v));
              if (!variants.length) return null;
              return (
                <article
                  key={state.id}
                  style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
                >
                  <h3 style={{ fontSize: 16, lineHeight: '22px', fontWeight: 700 }}>
                    {state.title}
                  </h3>
                  {variants.map((variant) => (
                    <figure
                      key={variant.id}
                      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                    >
                      <figcaption>
                        <a href={`?state=${variant.id}`} style={link}>
                          <code>{variant.id}</code>
                        </a>
                      </figcaption>
                      {state.isolated ? (
                        <iframe
                          title={variant.id}
                          src={`?state=${variant.id}`}
                          loading="lazy"
                          width={960}
                          height={600}
                          style={{
                            border: '1px solid var(--jh-border-strong)',
                            borderRadius: 12,
                            maxWidth: '100%',
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            border: '1px solid var(--jh-border-strong)',
                            borderRadius: 12,
                            overflow: 'hidden',
                          }}
                        >
                          <StateRoot variant={variant} />
                        </div>
                      )}
                    </figure>
                  ))}
                </article>
              );
            })}
          </section>
        ))}
      </main>
      <Settle variant={null} />
    </UiRoot>
  );
}

function Missing({ id }) {
  useEffect(() => {
    console.error(`gallery: no state ${id}`);
    document.documentElement.setAttribute(READY_ATTRIBUTE, 'timeout');
  }, [id]);
  return <p>No state {id}.</p>;
}

const params = new URLSearchParams(location.search);
const only = params.get('state');
const variant = only ? variantById(only) : null;

// A catalogue entry without a drawing, or a drawing not in the catalogue, is
// a mistake the tests should see.
for (const state of CATALOG) {
  if (!RENDERS[state.id]) console.error(`gallery: ${state.id} is in catalog.js but not states.jsx`);
}
for (const id of Object.keys(RENDERS)) {
  if (!CATALOG.some((s) => s.id === id))
    console.error(`gallery: ${id} is in states.jsx but not catalog.js`);
}

let page = <IndexPage params={params} />;
if (only) page = variant ? <StatePage variant={variant} /> : <Missing id={only} />;

createRoot(document.getElementById('root')).render(<StrictMode>{page}</StrictMode>);
