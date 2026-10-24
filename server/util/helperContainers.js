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

/**
 * CI job containers (#240). Gitea's act_runner names the container of each job,
 * and each service container of the job, after the task:
 * `GITEA-ACTIONS-TASK-<task id>-WORKFLOW-<workflow>-JOB-<job>-<hash>`. Each one
 * lives for one job and is removed, so it is no service either, and discovery
 * drops it the same way: by name in the PromQL selector, plus a guard on the
 * names returned. A job that ran a minute or more would otherwise leave a grey
 * "last seen" card for 24 hours, and turn the global status "degraded".
 */
export const JOB_CONTAINER_PREFIX = 'GITEA-ACTIONS-TASK-';

/**
 * The handbook build (#684). homelab-infra builds the handbook in a throwaway
 * container named `handbook-build-<pid>` that lives about nine minutes after
 * each docs merge and is removed on exit. Same treatment as a CI job. Only the
 * prefix counts: the handbook site itself (`handbook`) is a service.
 */
export const HANDBOOK_BUILD_PREFIX = 'handbook-build-';

/** Names that start with one of these are throwaway containers, never services. */
export const IGNORED_NAME_PREFIXES = [JOB_CONTAINER_PREFIX, HANDBOOK_BUILD_PREFIX];

// The prefixes as a regex alternation, escaped for the regex and then for the
// PromQL string literal that carries it.
const escapeRegex = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const promString = (t) => t.replace(/\\/g, '\\\\');
const PREFIX_ALTERNATION = IGNORED_NAME_PREFIXES.map(escapeRegex).join('|');

// Prometheus anchors the regex: names that start with a prefix.
export const NOT_JOB = `name!~"${promString(`(${PREFIX_ALTERNATION}).+`)}"`;

/** Whether a container name is a throwaway one (see IGNORED_NAME_PREFIXES). */
export const isJobContainer = (name) =>
  typeof name === 'string' && IGNORED_NAME_PREFIXES.some((p) => name.length > p.length && name.startsWith(p));
