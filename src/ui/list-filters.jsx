/*
 * ListFilters (#313): a list page's filters in one row that wraps, under its
 * heading, 12px apart: the controls of `filters`, in their order, then "Clear
 * filters" (a ghost accent Button, Lucide `X`) while any is set. The
 * Services and Infrastructure pages draw it, and so does the Alerts page,
 * through AlertFilters (alert-filters.jsx), one configuration of it (#314).
 *
 * Each of `filters` is a control, by its `kind`:
 *
 *   search     an Input filling the row (at least 192px), named by its
 *              `label`, which is its placeholder too
 *   select     a Select, 176px unless its `className` says otherwise (the
 *              default)
 *   segmented  a SegmentedControl, every option in view (two to four)
 *
 * It holds nothing: each is `{ kind, id, label, value, onValueChange, items?,
 * className? }`, `value` the chosen value (the search's text), `items` the
 * options `[{ value, label }]`, the first for "every one", and
 * `onValueChange` what a change calls (the search with its text; the others
 * as Base UI calls them, with the value first). `onClear` clears them all
 * (none, no button). The row is a group named "Filters".
 */
import { X } from 'lucide-react';
import { Button } from './button.jsx';
import { Input } from './input.jsx';
import { SegmentedControl } from './segmented-control.jsx';
import { Select } from './select.jsx';
import { cn } from './lib/utils.js';

function Control({ kind = 'select', id, label, value, items, onValueChange, className }) {
  if (kind === 'search') {
    return (
      <Input
        type="search"
        data-filter={id}
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className={cn('w-auto min-w-48 flex-1', className)}
      />
    );
  }
  if (kind === 'segmented') {
    return (
      <SegmentedControl
        data-filter={id}
        aria-label={label}
        options={items}
        value={value}
        onValueChange={onValueChange}
        className={className}
      />
    );
  }
  return (
    <Select
      data-filter={id}
      aria-label={label}
      items={items}
      value={value}
      onValueChange={onValueChange}
      className={cn('w-44', className)}
    />
  );
}

function ListFilters({ filters = [], onClear, className, ...props }) {
  return (
    <div
      data-slot="list-filters"
      role="group"
      aria-label="Filters"
      className={cn('flex flex-wrap items-center gap-3', className)}
      {...props}
    >
      {filters.map((f) => (
        <Control key={f.id} {...f} />
      ))}
      {onClear && (
        <Button variant="ghost" tone="accent" onClick={onClear}>
          <X aria-hidden="true" />
          Clear filters
        </Button>
      )}
    </div>
  );
}

export { ListFilters };
