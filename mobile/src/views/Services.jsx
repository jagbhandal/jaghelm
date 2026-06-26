import React, { useState, useMemo } from 'react';
import FilterChips from '../components/FilterChips.jsx';
import SearchBar from '../components/SearchBar.jsx';
import ServiceRow from '../components/ServiceRow.jsx';
import { flattenServices, sortProblemsFirst } from '../data/derive.js';

export default function Services({ data, nav }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const flat = useMemo(() => sortProblemsFirst(flattenServices(data.servicesBody)), [data.servicesBody]);
  const nodeKeys = useMemo(() => [...new Set(flat.map((s) => s.nodeKey))], [flat]);

  const chips = [{ id: 'all', label: 'All' }, { id: 'down', label: 'Down' }, ...nodeKeys.map((k) => ({ id: k, label: k }))];

  const visible = flat.filter((s) => {
    if (filter === 'down' && s.status !== 'down') return false;
    if (filter !== 'all' && filter !== 'down' && s.nodeKey !== filter) return false;
    if (query && !s.display_name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <section className="mobile-view" aria-label="Services">
      <h1>Services</h1>
      <SearchBar value={query} onChange={setQuery} placeholder="Search services" />
      <FilterChips chips={chips} active={filter} onChange={setFilter} />
      <div className="svc-list">
        {visible.map((s) => (
          <ServiceRow key={s.uid} service={s} onTap={() => nav.push('serviceDetail', { uid: s.uid })} />
        ))}
        {visible.length === 0 && <p className="mobile-view__todo">No services match.</p>}
      </div>
    </section>
  );
}
