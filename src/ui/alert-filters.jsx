/*
 * AlertFilters (#314): the Alerts page's filters, ListFilters configured
 * (list-filters.jsx, #313): in one row that wraps, the severity (segmented:
 * All, Critical, Warning, Info), the kind of entity (a Select, 192px:
 * Everything, Services, Nodes…), the search (filling the rest), and "Clear
 * filters" while any is set. Each is named (Severity, Kind, Search alerts).
 *
 * It holds nothing: `severity` and `kind` are the chosen values ('all' for
 * none), `search` the box's text, and `onSeverity`, `onKind`, `onSearch`
 * (the text) and `onClear` change them. `severities` and `kinds` are the
 * options, [{ value, label }], the first of each "all".
 */
import { ListFilters } from './list-filters.jsx';

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
  ...props
}) {
  return (
    <ListFilters
      data-slot="alert-filters"
      filters={[
        {
          kind: 'segmented',
          id: 'severity',
          label: 'Severity',
          value: severity,
          items: severities,
          onValueChange: onSeverity,
        },
        {
          id: 'kind',
          label: 'Kind',
          value: kind,
          items: kinds,
          onValueChange: onKind,
          width: 'wide',
        },
        { kind: 'search', id: 'q', label: 'Search alerts', value: search, onValueChange: onSearch },
      ]}
      onClear={onClear}
      {...props}
    />
  );
}

export { AlertFilters };
