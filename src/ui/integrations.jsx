/*
 * Settings → Integrations' parts (#323, spec §7): the apps JagHelm reads
 * headline stats from. Three parts, all drawn from props alone (the section,
 * sections/Integrations.jsx, owns the requests):
 *
 * IntegrationList ("Connected"): a row per configured integration, its lamp
 * and the status model's word for it (the board's own, so a failing fetch
 * reads the same here), its name (a heading, h3) and what it says of itself:
 * a preset's name or "Custom", its address and the service it is scoped to.
 * Its actions are Disable or Enable, Edit and Remove, each named by the
 * integration (aria-label), Remove a Confirm that names it by its display
 * name, never its storage key. An address that carries a credential is never
 * shown (`urlHidden`).
 *
 * PresetGallery ("Add an integration"): the presets as tiles, a search and a
 * category, and the custom builder; a preset already set up says so.
 *
 * IntegrationForm: one integration's configuration, a form of `fields`
 * (text, secret, select, check), the Test and Save buttons, the outcome of a
 * test, and Remove (a Confirm) when it edits an existing one. A secret field
 * (`secret`) is a password input that is never filled in: a stored credential
 * is kept by leaving it blank, and the form says so. The outcome of a test is
 * a sentence the server gave; the form shows it as it is.
 */
import { Check, ChevronLeft, Plug, Plus, Search } from 'lucide-react';
import { Banner } from './banner.jsx';
import { Button } from './button.jsx';
import { Checkbox } from './checkbox.jsx';
import { Confirm } from './confirm.jsx';
import { EmptyState } from './empty-state.jsx';
import { Field } from './field.jsx';
import { Input } from './input.jsx';
import { Panel } from './panel.jsx';
import { Select } from './select.jsx';
import { StatusLamp } from './status-lamp.jsx';
import { StatusWord } from './status-word.jsx';
import { cn } from './lib/utils.js';
import { WORDS, toState } from './lib/status.js';

/** The app's mark: its icon over its initials, which stay if the icon doesn't load. */
function AppChip({ name, src }) {
  const initials = (name || '?')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      aria-hidden="true"
      data-slot="app-chip"
      className="relative inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-3 text-caption font-bold text-text-2"
    >
      {initials}
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={(e) => {
            e.currentTarget.hidden = true;
          }}
          className="absolute inset-0 size-full bg-surface-3 object-contain p-1"
        />
      ) : null}
    </span>
  );
}

/** What Remove says will happen: stored credentials are deleted only where there are some. */
const removeText = (secrets) =>
  `It stops adding stats to its service${secrets ? ', and its stored password and token are deleted' : ''}. This can't be undone.`;

function IntegrationRow({ row, onToggle, onEdit, onRemove }) {
  const state = row.state == null ? null : toState(row.state);
  const said = row.word || (state ? WORDS[state] : '');
  const parts = [
    { text: row.kind },
    row.urlHidden
      ? { text: 'address not shown: it carries a credential' }
      : { text: row.url, mono: true },
    { text: row.target ? `→ ${row.target}` : null },
  ].filter((p) => p.text);
  const meta = parts.map((p) => p.text);
  return (
    <li
      id={row.anchor}
      data-slot="integration-row"
      data-integration={row.id}
      className={cn('@container', row.enabled === false && 'bg-surface-2/40')}
    >
      <div className="flex flex-col gap-2 px-panel py-3 @xl:flex-row @xl:items-start @xl:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <AppChip name={row.name} src={row.iconSrc} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h3 className="text-body font-semibold text-text-1">{row.name}</h3>
            <p className="text-caption text-text-3 wrap-anywhere">
              {parts.map((part, n) => (
                <span key={n}>
                  {n > 0 ? ' · ' : null}
                  {part.mono ? (
                    <span className="font-mono text-text-2">{part.text}</span>
                  ) : (
                    part.text
                  )}
                </span>
              ))}
            </p>
            <p className="flex items-center gap-2 text-body-sm">
              {state ? <StatusLamp state={state} decorative /> : null}
              {state ? (
                <StatusWord state={state} word={said} />
              ) : (
                <span className="font-semibold text-text-3">{said}</span>
              )}
            </p>
            {row.error ? (
              <p
                className={cn(
                  'text-body-sm wrap-anywhere',
                  state === 'warn' ? 'text-warn-fg' : 'text-text-2'
                )}
              >
                {row.error}
              </p>
            ) : null}
            {(row.notes ?? []).map((line, n) => (
              <p key={n} className="text-body-sm text-text-2">
                {line}
              </p>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 @xl:justify-end">
          {row.retired ? null : (
            <>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`${row.enabled === false ? 'Enable' : 'Disable'} ${row.name}`}
                onClick={() => onToggle?.(row.id)}
              >
                {row.enabled === false ? 'Enable' : 'Disable'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                tone="accent"
                aria-label={`Edit ${row.name}`}
                onClick={() => onEdit?.(row.id)}
              >
                Edit
              </Button>
            </>
          )}
          <Confirm
            trigger={
              <Button variant="ghost" size="sm" aria-label={`Remove ${row.name}`}>
                Remove
              </Button>
            }
            title="Remove this integration?"
            name={row.name}
            detail={meta.slice(0, 2).join(' · ') || undefined}
            value={row.id}
            description={removeText(row.secrets)}
            confirmLabel="Remove integration"
            destructive
            onConfirm={(id) => onRemove?.(id)}
          />
        </div>
      </div>
    </li>
  );
}

/**
 * Props: `id` (the panel's anchor), `rows` (each `{ id, name, kind, url,
 * urlHidden, target, state, word, error, notes, enabled, secrets, iconSrc }`), `note`
 * (a stale status's "No signal · last known 3 min ago"), `onToggle(id)` (`retired` rows show only Remove),
 * `onEdit(id)`, `onRemove(id)`, `onAdd()` (the empty state's button),
 * `notice` (a line above the rows: why they are less than they could be),
 * `loading` (the first read), `unread` (`{ error, onRetry }`: the list
 * couldn't be read, and why, in place of rows that would look like none are
 * set up).
 */
function IntegrationList({
  title = 'Connected',
  description = 'Each integration adds a headline stat to its service row and a section to its detail drawer.',
  note = null,
  rows = [],
  onToggle,
  onEdit,
  onRemove,
  onAdd,
  notice = null,
  loading = false,
  unread = null,
  className,
  ...props
}) {
  return (
    <Panel
      flush
      title={title}
      description={description}
      actions={
        note ? <span className="text-caption font-semibold text-unknown-fg">{note}</span> : null
      }
      className={className}
      {...props}
    >
      {notice ? (
        <p role="status" className="border-b border-border px-panel py-3 text-body-sm text-warn-fg">
          {notice}
        </p>
      ) : null}
      {loading ? (
        <p className="px-panel py-4 text-body-sm text-text-3">Loading integrations…</p>
      ) : unread ? (
        <div className="flex flex-wrap items-center gap-3 px-panel py-4">
          <p role="alert" className="text-body-sm text-crit-fg wrap-anywhere">
            {unread.error}
          </p>
          {unread.onRetry ? (
            <Button variant="secondary" size="sm" onClick={() => unread.onRetry()}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Plug />}
          title="No integrations yet"
          description="Add one from the presets below, or a custom one from any JSON API, to see its stats on the board."
          action={
            onAdd ? (
              <Button variant="secondary" size="sm" onClick={() => onAdd()}>
                <Plus /> Custom integration
              </Button>
            ) : null
          }
        />
      ) : (
        <ul data-slot="integration-list" className="divide-y divide-border">
          {rows.map((row) => (
            <IntegrationRow
              key={row.id}
              row={row}
              onToggle={onToggle}
              onEdit={onEdit}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * Props: `id`, `presets` (each `{ type, name, description, auth, iconSrc,
 * configured }`, already filtered), `total` (how many there are before the
 * filter), `search` / `onSearch(text)`, `category` / `onCategory(id)` /
 * `categories` (each `{ value, label }`, with counts in the label),
 * `onPick(type)`, `onCustom()`.
 */
function PresetGallery({
  title = 'Add an integration',
  presets = [],
  total = presets.length,
  search = '',
  onSearch,
  category = 'all',
  onCategory,
  categories = [],
  onPick,
  onCustom,
  className,
  ...props
}) {
  return (
    <Panel
      title={title}
      description={`${total} ${total === 1 ? 'preset' : 'presets'}, or a custom one from any JSON API.`}
      actions={
        <Button variant="secondary" size="sm" onClick={() => onCustom?.()}>
          <Plus /> Custom integration
        </Button>
      }
      className={className}
      {...props}
    >
      <div className="@container flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-2 @xl:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-3"
              strokeWidth={1.75}
            />
            <Input
              type="search"
              aria-label="Search presets"
              placeholder="Search presets"
              value={search}
              onChange={(e) => onSearch?.(e.target.value)}
              className="pl-8"
            />
          </div>
          {categories.length > 0 ? (
            <Select
              aria-label="Category"
              items={categories}
              value={category}
              onValueChange={(v) => onCategory?.(v)}
              className="@xl:w-60"
            />
          ) : null}
        </div>
        {presets.length === 0 ? (
          <EmptyState size="sm" title="No presets match that search." />
        ) : (
          <ul
            data-slot="preset-grid"
            className="grid grid-cols-1 gap-2.5 @xl:grid-cols-2 @4xl:grid-cols-3"
          >
            {presets.map((p) => (
              <li key={p.type} className="min-w-0">
                <button
                  type="button"
                  data-preset={p.type}
                  onClick={() => onPick?.(p.type)}
                  className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-surface-1 p-2.5 text-left transition-colors hover:border-border-strong hover:bg-surface-2"
                >
                  <AppChip name={p.name} src={p.iconSrc} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body-sm font-semibold text-text-1">
                      {p.name}
                    </span>
                    <span className="truncate text-caption text-text-3">
                      {p.description || p.auth}
                    </span>
                  </span>
                  {p.configured ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-caption font-semibold text-text-2">
                      <Check className="size-3.5" strokeWidth={2} aria-hidden="true" />
                      Set up
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/** One field of the form, by its `kind`. */
function FormField({ field }) {
  const { id, kind = 'text', label, description, error, value, onChange, wide } = field;
  const shown = error ? <span role="alert">{error}</span> : undefined;
  if (kind === 'check') {
    return (
      <label data-field={id} className={cn('flex items-start gap-2.5', wide && '@xl:col-span-2')}>
        <Checkbox
          checked={Boolean(value)}
          onCheckedChange={(v) => onChange?.(v)}
          className="mt-0.5"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-body-sm font-semibold text-text-1">{label}</span>
          {description ? <span className="text-caption text-text-3">{description}</span> : null}
        </span>
      </label>
    );
  }
  return (
    <Field
      label={label}
      description={description}
      error={shown}
      className={cn(wide && '@xl:col-span-2')}
      data-field={id}
    >
      {kind === 'select' ? (
        <Select items={field.items} value={value} onValueChange={(v) => onChange?.(v)} />
      ) : (
        <Input
          ref={field.inputRef}
          type={kind === 'secret' ? 'password' : 'text'}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={field.placeholder}
          autoComplete={kind === 'secret' ? 'new-password' : 'off'}
          spellCheck={false}
          className={field.mono ? 'font-mono' : undefined}
        />
      )}
    </Field>
  );
}

/** A test's outcome: the server's sentence, in words and a lamp, never colour alone. */
function TestOutcome({ test }) {
  if (!test) return null;
  if (test.state === 'testing') {
    return (
      <p role="status" className="text-body-sm text-text-2">
        Testing…
      </p>
    );
  }
  const ok = test.state === 'ok';
  return (
    <p role="status" data-slot="test-outcome" className="flex items-start gap-2 text-body-sm">
      <StatusLamp state={ok ? 'ok' : 'warn'} decorative className="mt-1.25" />
      <span className={cn('wrap-anywhere', ok ? 'text-ok-fg' : 'text-warn-fg')}>
        <span className="font-semibold">{ok ? 'Connected' : 'Test failed'}</span>
        {test.sentence ? `: ${test.sentence}` : null}
      </span>
    </p>
  );
}

/**
 * Props: `title`, `description`, `backLabel` / `onBack`, `fields` (each
 * `{ id, kind: 'text' | 'secret' | 'select' | 'check', label, description,
 * value, onChange(value), placeholder, error, mono, items, wide, inputRef }`),
 * `notes` (each `{ tone, title, cause }`, a Banner), `dataFields` (the
 * labels of what a preset reads, shown as chips), `test` (null, `{ state:
 * 'testing' }` or `{ state: 'ok' | 'failed', sentence }`), `saveState`
 * (null, 'saving' or 'saved'), `saveError` (a refusal that belongs to no
 * field), `canSubmit`, `onTest()`, `onSave()`, and `remove` (`{ name, detail,
 * value, onRemove(value) }`, when editing).
 */
function IntegrationForm({
  title,
  description,
  backLabel = 'Back',
  onBack,
  fields = [],
  notes = [],
  dataFields = [],
  test = null,
  saveState = null,
  saveError = null,
  canSubmit = true,
  onTest,
  onSave,
  remove = null,
  className,
  ...props
}) {
  return (
    <Panel
      title={title}
      description={description}
      icon={<Plug />}
      actions={
        <Button variant="ghost" size="sm" onClick={() => onBack?.()}>
          <ChevronLeft /> {backLabel}
        </Button>
      }
      className={className}
      {...props}
    >
      <form
        data-slot="integration-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && saveState !== 'saving') onSave?.();
        }}
        className="@container flex min-w-0 flex-col gap-4"
      >
        {notes.map((n, i) => (
          <Banner key={i} tone={n.tone ?? 'info'} title={n.title} cause={n.cause} />
        ))}
        <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
          {fields.map((f) => (
            <FormField key={f.id} field={f} />
          ))}
        </div>
        {dataFields.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-body-sm font-semibold text-text-1">Stats it reads</p>
            <ul className="flex flex-wrap gap-1.5">
              {dataFields.map((label) => (
                <li
                  key={label}
                  className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-caption text-text-2"
                >
                  {label}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={!canSubmit || test?.state === 'testing'}
            onClick={() => onTest?.()}
          >
            {test?.state === 'testing' ? 'Testing…' : 'Test connection'}
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit || saveState === 'saving'}>
            {saveState === 'saving'
              ? 'Saving…'
              : saveState === 'saved'
                ? 'Saved'
                : 'Save integration'}
          </Button>
          {remove ? (
            <Confirm
              trigger={
                <Button variant="danger" className="ml-auto">
                  Remove
                </Button>
              }
              title="Remove this integration?"
              name={remove.name}
              detail={remove.detail}
              value={remove.value}
              description={removeText(remove.secrets)}
              confirmLabel="Remove integration"
              destructive
              onConfirm={(v) => remove.onRemove?.(v)}
            />
          ) : null}
        </div>
        <TestOutcome test={test} />
        {saveError ? (
          <p role="alert" className="text-body-sm text-crit-fg wrap-anywhere">
            Not saved: {saveError}
          </p>
        ) : null}
      </form>
    </Panel>
  );
}

export { AppChip, IntegrationList, PresetGallery, IntegrationForm };
