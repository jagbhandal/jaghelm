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

// Prometheus anchors the regex: names that start with the prefix.
export const NOT_JOB = `name!~"${JOB_CONTAINER_PREFIX}.+"`;

/** Whether a container name is a CI job's (see JOB_CONTAINER_PREFIX). */
export const isJobContainer = (name) =>
  typeof name === 'string' && name.length > JOB_CONTAINER_PREFIX.length && name.startsWith(JOB_CONTAINER_PREFIX);
