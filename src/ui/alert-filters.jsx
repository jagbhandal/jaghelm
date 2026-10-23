/*
 * AlertFilters (#314): the Alerts page's filters, in one row that wraps: the
 * severity (a SegmentedControl: All, Critical, Warning, Info), the kind of
 * entity (a Select: Everything, Services, Nodes…), the search (an Input,
 * filling the rest), and "Clear filters" (a ghost accent Button) while any is
 * set. Each is named (Severity, Kind, Search alerts).
 *
 * It holds nothing: `severity` and `kind` are the chosen values ('all' for
 * none), `search` the box's text, and `onSeverity`, `onKind`, `onSearch`
 * (the text) and `onClear` change them. `severities` and `kinds` are the
 * options, [{ value, label }], the first of each "all".
 */
import { X } from 'lucide-react';
import { Button } from './button.jsx';
import { Input } from './input.jsx';
import { SegmentedControl } from './segmented-control.jsx';
import { Select } from './select.jsx';
import { cn } from './lib/utils.js';

function AlertFilters({
  severity,
  kind,
  search,
  severities,
  kinds,
  onSeverity,
  onKind,
  onSearch,
  onClear,
  className,
  ...props
}) {
  return (
    <div
      data-slot="alert-filters"
      className={cn('flex flex-wrap items-center gap-3', className)}
      {...props}
    >
      <SegmentedControl
        aria-label="Severity"
        options={severities}
        value={severity}
        onValueChange={onSeverity}
      />
      <Select
        aria-label="Kind"
        items={kinds}
        value={kind}
        onValueChange={onKind}
        className="w-48"
      />
      <Input
        type="search"
        aria-label="Search alerts"
        placeholder="Search alerts"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        className="w-auto min-w-48 flex-1"
      />
      {onClear && (
        <Button variant="ghost" tone="accent" onClick={onClear}>
          <X aria-hidden="true" />
          Clear filters
        </Button>
      )}
    </div>
  );
}

export { AlertFilters };
