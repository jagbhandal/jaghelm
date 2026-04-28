import { extractValue } from './extract.js';

/**
 * Display formatting + derived field computation.
 *
 * formatValue: converts a raw extracted value into a human-readable string
 *   based on the field's declared format (number, decimal, percent, ms, bytes,
 *   duration, string).
 *
 * computeField: produces a derived value from multiple paths in the source
 *   data. Currently supports percent_of, subtract, sum.
 */

/** Format a raw value according to field format. */
export function formatValue(raw, format) {
  if (raw == null || raw === undefined) return '—';

  switch (format) {
    case 'number':
      return typeof raw === 'number' ? raw.toLocaleString() : String(raw);
    case 'decimal':
      return typeof raw === 'number' ? raw.toFixed(1) : String(raw);
    case 'percent':
      return typeof raw === 'number' ? `${raw.toFixed(1)}%` : String(raw);
    case 'ms':
      // Input is typically seconds, convert to ms
      return typeof raw === 'number' ? `${Math.round(raw * 1000)}ms` : String(raw);
    case 'bytes': {
      if (typeof raw !== 'number') return String(raw);
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let val = raw;
      let i = 0;
      while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
      return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }
    case 'duration': {
      if (typeof raw !== 'number') return String(raw);
      const h = Math.floor(raw / 3600);
      const m = Math.floor((raw % 3600) / 60);
      if (h > 0) return `${h}h ${m}m`;
      if (m > 0) return `${m}m`;
      return `${Math.round(raw)}s`;
    }
    case 'string':
    default:
      return String(raw);
  }
}

/** Compute a derived field from one or more paths in the source data. */
export function computeField(data, field) {
  switch (field.compute) {
    case 'percent_of': {
      const num = extractValue(data, field.numerator);
      const den = extractValue(data, field.denominator);
      if (typeof num !== 'number' || typeof den !== 'number' || den === 0) return '0%';
      return `${((num / den) * 100).toFixed(1)}%`;
    }
    case 'subtract': {
      const a = extractValue(data, field.a);
      const b = extractValue(data, field.b);
      if (typeof a !== 'number' || typeof b !== 'number') return '—';
      return formatValue(a - b, field.format || 'number');
    }
    case 'sum': {
      const paths = field.paths || [];
      const total = paths.reduce((acc, p) => {
        const v = extractValue(data, p);
        return acc + (typeof v === 'number' ? v : 0);
      }, 0);
      return formatValue(total, field.format || 'number');
    }
    default:
      return '—';
  }
}
