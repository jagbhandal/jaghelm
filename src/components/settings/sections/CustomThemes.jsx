import { useMemo, useRef, useState } from 'react';
import { ActionRow, FormNote, SettingBlock, SettingRow, SettingRows } from '@ui/appearance';
import { Banner } from '@ui/banner';
import { Button } from '@ui/button';
import { Field } from '@ui/field';
import { Panel } from '@ui/panel';
import { Textarea } from '@ui/textarea';
import { useThemeLibrary } from './themeLibrary.js';
import { MAX_THEMES, THEME_TOKENS, validateTheme } from '../../../../server/themes.js';

/**
 * Settings → Appearance → Custom themes (#331): where a theme comes from, and
 * what became of the ones JagHelm has.
 *
 * A theme comes from here, pasted or read from a .json file, into the display
 * config's `themes` (so every device has it; the choice of which one to wear
 * stays per browser, as dark and light do). The same validator runs as the
 * text changes (server/themes.js, the contrast rules of #283) and the Import
 * button stays off until the theme passes; a theme that fails says which
 * pairings and by how much. The server checks again on save, and the app again
 * when the config loads, so a config edited by hand cannot smuggle one in.
 *
 * Below the form: the themes that loaded (each is a card in Theme above) and
 * the rejected ones, with why, never dropped silently, each with Remove.
 */

/** What the textarea holds as a verdict: nothing yet, text that isn't JSON, or the validator's answer. */
function check(text) {
  if (!text.trim()) return { state: 'empty' };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { state: 'json', why: err instanceof Error ? err.message : 'not JSON' };
  }
  const result = validateTheme(raw);
  return result.ok ? { state: 'ok', theme: result.theme } : { state: 'rejected', ...result };
}

/** Most characters the box takes: a theme is a few KB; a file past this is refused. */
const MAX_TEXT = 64 * 1024;

const colours = (n) => `${n} ${n === 1 ? 'colour' : 'colours'}`;

const PLACEHOLDER =
  '{ "id": "midnight", "name": "Midnight", "base": "dark", "tokens": { "bg": "oklch(0.15 0.02 255)" } }';

export default function CustomThemesPanel({ config, update, anchor, defaultText = '' }) {
  const [text, setText] = useState(defaultText);
  const [fileError, setFileError] = useState('');
  const fileInput = useRef(null);
  const { valid, rejected } = useThemeLibrary(config.themes);
  const list = Array.isArray(config.themes) ? config.themes : [];
  const verdict = useMemo(() => check(text), [text]);
  const replaces = verdict.state === 'ok' && valid.some((t) => t.id === verdict.theme.id);
  const full = verdict.state === 'ok' && !replaces && list.length >= MAX_THEMES;

  const importTheme = () => {
    if (verdict.state !== 'ok' || full) return;
    const { id } = verdict.theme;
    // The theme as written, so a colour the validator reads is kept as the author wrote it.
    const written = JSON.parse(text);
    const at = list.findIndex((t) => t && t.id === id);
    update('themes', at >= 0 ? list.map((t, i) => (i === at ? written : t)) : [...list, written]);
    setText('');
  };

  const pickFile = async (file) => {
    setFileError('');
    if (!file) return;
    if (file.size > MAX_TEXT) {
      setFileError('That file is too large for a theme (64 KB at most).');
      return;
    }
    try {
      setText(await file.text());
    } catch {
      setFileError('That file could not be read.');
    }
  };

  const remove = (index) =>
    update(
      'themes',
      list.filter((_, i) => i !== index)
    );

  // Each theme's place in the config's list, for Remove.
  const placeOf = (id) => list.findIndex((t) => t && t.id === id);

  return (
    <Panel
      flush
      title="Custom themes"
      description={`Add a theme as JSON, up to ${MAX_THEMES}. It loads only if its text, status and accent colours stay readable; otherwise it is rejected, and the pairing that fails is named.`}
      {...anchor}
    >
      <SettingRows>
        <SettingBlock>
          <Field
            label="Theme JSON"
            description={`An id, a name, a base (dark or light) and tokens: any of ${THEME_TOKENS.length} colour roles, written #rrggbb or oklch(L C H / A).`}
          >
            <Textarea
              mono
              rows={8}
              maxLength={MAX_TEXT}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={PLACEHOLDER}
              aria-invalid={
                verdict.state === 'json' || verdict.state === 'rejected' ? true : undefined
              }
            />
          </Field>

          <div aria-live="polite" data-slot="theme-verdict">
            {verdict.state === 'json' ? (
              <Banner tone="crit" title="That is not valid JSON" cause={verdict.why} />
            ) : null}
            {verdict.state === 'rejected' ? (
              <Banner
                tone="crit"
                title={`${verdict.name ?? verdict.id ?? 'This theme'} would be rejected`}
                cause={verdict.reasons.join('; ')}
              />
            ) : null}
            {verdict.state === 'ok' ? (
              <FormNote>
                {verdict.theme.name}: {verdict.theme.base} base,{' '}
                {colours(Object.keys(verdict.theme.tokens).length)}.{' '}
                {replaces ? 'It replaces the theme with the same id.' : 'Ready to import.'}
                {verdict.theme.setsAccent ? ' It sets its own accent.' : ''}
              </FormNote>
            ) : null}
            {full ? (
              <Banner
                tone="warn"
                title={`JagHelm keeps ${MAX_THEMES} themes`}
                cause="Remove one below to add another."
              />
            ) : null}
            {fileError ? (
              <Banner tone="crit" title="Could not use that file" cause={fileError} />
            ) : null}
          </div>

          <ActionRow>
            <Button onClick={importTheme} disabled={verdict.state !== 'ok' || full}>
              {replaces ? 'Replace theme' : 'Import theme'}
            </Button>
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>
              Choose a .json file
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              hidden
              aria-label="Theme file"
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            {text ? (
              <Button variant="ghost" onClick={() => setText('')}>
                Clear
              </Button>
            ) : null}
          </ActionRow>
        </SettingBlock>

        <SettingRows
          title="Your themes"
          description={
            valid.length === 0 && rejected.length === 0
              ? 'None yet. Dark, light and system are always there.'
              : 'These are offered beside Dark, Light and System above.'
          }
        >
          {valid.map((t) => (
            <SettingRow
              key={t.id}
              label={t.name}
              description={`${t.base} base, ${colours(Object.keys(t.tokens).length)}${
                t.setsAccent ? ', sets its own accent' : ''
              }`}
              control={() => (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${t.name}`}
                  onClick={() => remove(placeOf(t.id))}
                >
                  Remove
                </Button>
              )}
            />
          ))}
        </SettingRows>

        {rejected.length > 0 ? (
          <SettingRows
            title="Rejected"
            description="These are in your config but do not load. Fix them there, or remove them."
          >
            {rejected.map((r) => (
              <SettingBlock key={r.index}>
                <Banner
                  tone="crit"
                  title={`${r.name ?? r.id ?? `Theme ${r.index + 1}`} is rejected`}
                  cause={r.reasons.join('; ')}
                  action={
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${r.name ?? r.id ?? `theme ${r.index + 1}`}`}
                      onClick={() => remove(r.index)}
                    >
                      Remove
                    </Button>
                  }
                />
              </SettingBlock>
            ))}
          </SettingRows>
        ) : null}
      </SettingRows>
    </Panel>
  );
}
