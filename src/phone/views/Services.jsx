import React, { useState, useMemo } from 'react';
import FilterChips from '../components/FilterChips.jsx';
import SearchBar from '../components/SearchBar.jsx';
import ServiceRow from '../components/ServiceRow.jsx';
import { FRESH, serviceRowsOf } from '../data/board.js';

/**
 * Services: every service card, worst first by the status model's ranking,
 * each with the model's lamp and word (#325). Down counts the services the
 * model calls down (crit).
 *
 * The web look (#303): the page's title, the search, the chips wrapping
 * under it, and the services as one list of the shared rows, each opening
 * the service. The same rows, chips and counts as the Android look.
 */
export default function Services(props) {
  if (__ANDROID_LOOK__) return <AndroidServices {...props} />;
  return <WebServices {...props} />;
}

/** The rows, the chips and what the search and the chip pressed leave: both looks'. */
function useServiceList(data) {
  const [chip, setChip] = useState('all');
  const [query, setQuery] = useState('');
  const { status, servicesBody } = data;
  const freshness = data.freshness ?? FRESH;

  const flat = useMemo(
    () => serviceRowsOf({ status, servicesBody, freshness }),
    [status, servicesBody, freshness]
  );

  const nodeKeys = useMemo(() => [...new Set(flat.map((s) => s.nodeKey))], [flat]);

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
    if (query && !(s.display_name || '').toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return { chip, setChip, query, setQuery, chips, shown };
}

function WebServices({ data, nav }) {
  const { chip, setChip, query, setQuery, chips, shown } = useServiceList(data);
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

function AndroidServices({ data, nav }) {
  const { chip, setChip, query, setQuery, chips, shown } = useServiceList(data);
  return (
    <section className="mobile-view" aria-label="Services">
      <h1>Services</h1>
      <SearchBar value={query} onChange={setQuery} placeholder="Search services" />
      <FilterChips chips={chips} active={chip} onChange={setChip} />
      <div className="svc-list">
        {shown.map((s) => (
          <ServiceRow
            key={s.uid}
            service={s}
            onTap={() => nav.push('serviceDetail', { uid: s.uid })}
          />
        ))}
        {shown.length === 0 && <p className="mobile-view__todo">No services match.</p>}
      </div>
    </section>
  );
}
