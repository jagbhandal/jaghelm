import React, { useState, useMemo } from 'react';
import FilterChips from '../components/FilterChips.jsx';
import SearchBar from '../components/SearchBar.jsx';
import ServiceRow from '../components/ServiceRow.jsx';
import { FRESH, serviceRowsOf } from '../data/board.js';

/**
 * Services: every service card, worst first by the status model's ranking,
 * each with the model's lamp and word (#325). Down counts the services the
 * model calls down (crit).
 */
export default function Services({ data, nav }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const { status, servicesBody } = data;
  const freshness = data.freshness ?? FRESH;

  const flat = useMemo(
    () => serviceRowsOf({ status, servicesBody, freshness }),
    [status, servicesBody, freshness],
  );

  const nodeKeys = useMemo(
    () => [...new Set(flat.map((s) => s.nodeKey))],
    [flat],
  );

  // Per-chip counts (Bug #11): All / Down / per-node.
  const chips = useMemo(() => [
    { id: 'all',  label: 'All',  count: flat.length },
    { id: 'down', label: 'Down', count: flat.filter((s) => s.modelState === 'crit').length },
    ...nodeKeys.map((k) => ({
      id:    k,
      label: flat.find((s) => s.nodeKey === k)?.nodeName || k,
      count: flat.filter((s) => s.nodeKey === k).length,
    })),
  ], [flat, nodeKeys]);

  const visible = flat.filter((s) => {
    if (filter === 'down' && s.modelState !== 'crit') return false;
    if (filter !== 'all' && filter !== 'down' && s.nodeKey !== filter) return false;
    if (query && !(s.display_name || '').toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <section className="mobile-view" aria-label="Services">
      <h1>Services</h1>
      <SearchBar value={query} onChange={setQuery} placeholder="Search services" />
      <FilterChips chips={chips} active={filter} onChange={setFilter} />
      <div className="svc-list">
        {visible.map((s) => (
          <ServiceRow
            key={s.uid}
            service={s}
            onTap={() => nav.push('serviceDetail', { uid: s.uid })}
          />
        ))}
        {visible.length === 0 && (
          <p className="mobile-view__todo">No services match.</p>
        )}
      </div>
    </section>
  );
}
