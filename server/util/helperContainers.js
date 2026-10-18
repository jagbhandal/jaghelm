/**
 * Short-lived helper containers started (and auto-removed) by Arcane carry the
 * Docker label `com.getarcaneapp.internal.resource=true`; cAdvisor exposes it as
 * the Prometheus label below. They are not services, so discovery drops them at
 * the source: via the PromQL selector, plus a guard on returned series.
 */
export const HELPER_LABEL = 'container_label_com_getarcaneapp_internal_resource';

// Absent label matches != "true", so ordinary containers are unaffected.
export const NOT_HELPER = `${HELPER_LABEL}!="true"`;

export const isHelperSeries = (r) => r?.metric?.[HELPER_LABEL] === 'true';
