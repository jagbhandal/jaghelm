import React, { useState, useMemo } from 'react';
import FilterChips from '../components/FilterChips.jsx';
import SearchBar from '../components/SearchBar.jsx';
import ServiceRow from '../components/ServiceRow.jsx';
import { FRESH, serviceRowsOf } from '../data/board.js';
import { cardMatches } from '../../shell/filterQuery.js';

/** The rows, the chips and what the search and the chip pressed leave. */
function useServiceList(data, filters = null) {
  const [ownChip, setOwnChip] = useState('all');
  const [ownQuery, setOwnQuery] = useState('');
  const query = filters ? (filters.query ?? '') : ownQuery;
  const setQuery = filters ? filters.onQuery : setOwnQuery;
  const { status, servicesBody } = data;
  const freshness = data.freshness ?? FRESH;

  const flat = useMemo(
    () => serviceRowsOf({ status, servicesBody, freshness }),
    [status, servicesBody, freshness]
  );

  const nodeKeys = useMemo(() => [...new Set(flat.map((s) => s.nodeKey))], [flat]);

  // A node in the address is its chip, when the list has it (one it doesn't,
  // or none, is All); otherwise All or Down, the screen's.
  const node = filters?.node && nodeKeys.includes(filters.node) ? filters.node : null;
  const chip = node || ownChip;
  const setChip = (id) => {
    if (!filters) return setOwnChip(id);
    const key = id === 'all' || id === 'down' ? null : id;
    setOwnChip(key ? 'all' : id);
    filters.onNode(key);
  };

  // Per-chip counts (Bug #11): All / Down / per-node.
  const chips = useMemo(
    () => [
      { id: 'all', label: 'All', count: flat.length },
      { id: 'down', label: 'Down', count: flat.filter((s) => s.modelState === 'crit').length },
      ...nodeKeys.map((k) => ({
        id: k,
        label: flat.find((s) => s.nodeKey === k)?.nodeName || k,
        count: flat.filter((s) => s.nodeKey === k).length,
      })),
    ],
    [flat, nodeKeys]
  );

  const shown = flat.filter((s) => {
    if (chip === 'down' && s.modelState !== 'crit') return false;
    if (chip !== 'all' && chip !== 'down' && s.nodeKey !== chip) return false;
    // The wide page's search (filterQuery.js), trimmed.
    if (!cardMatches(query, s)) return false;
    return true;
  });

  return { chip, setChip, query, setQuery, chips, shown };
}

/**
 * Services: every service card, worst first by the status model's ranking,
 * each with the model's lamp and word (#325). Down counts the services the
 * model calls down (crit).
 *
 * The page (#303): the page's title, the search, the chips wrapping
 * under it, and the services as one list of the shared rows, each opening
 * the service.
 *
 * The search is the wide Services page's (filterQuery.js cardMatches), in
 * the wide page's: each of its words, trimmed, in a service's name, its node's key
 * or name, or its Docker name, so one search lists the same services at
 * 767px and 1440px.
 *
 * `filters` (#313): the search and the node chip kept in the
 * page's address, as the wide Services page reads them, so a window
 * crossing 768px keeps them: `{ query, onQuery(text), node, onNode(key |
 * null) }`; a node the list doesn't have is All. Down stays the screen's own
 * (the wide page has no such filter). Without it, the screen keeps both.
 */
export default function Services({ data, nav, filters = null }) {
  const { chip, setChip, query, setQuery, chips, shown } = useServiceList(data, filters);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-title">Services</h1>
      <SearchBar value={query} onChange={setQuery} placeholder="Search services" />
      <FilterChips chips={chips} active={chip} onChange={setChip} />
      {shown.length > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-1">
          {shown.map((s) => (
            <li key={s.uid}>
              <ServiceRow service={s} onTap={() => nav.push('serviceDetail', { uid: s.uid })} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-text-2">No services match.</p>
      )}
    </div>
  );
}
