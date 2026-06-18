/**
 * Shared shape declarations for JagHelm's most type-hungry surface: the merged
 * runtime config. Starter typedefs — expand as files opt into `// @ts-check`.
 * See docs/IMPROVEMENT-PLAN.md Phase 1 (Architecture & Tech Debt).
 */

/** A single monitored node (host) as discovered/overridden. */
export interface NodeConfig {
  key: string;
  name?: string;
  subtitle?: string;
  icon?: string;
  color?: string;
}

/** Per-service display override keyed by `nodeKey:containerName`. */
export interface ServiceOverride {
  name?: string;
  icon?: string;
  monitor?: string;
  group?: string;
}

/** Infrastructure config persisted to data/services.yaml. */
export interface ServicesConfig {
  nodes?: NodeConfig[];
  services?: Record<string, ServiceOverride>;
  [key: string]: unknown;
}

/** UI/display config persisted to data/display-config.json. */
export interface DisplayConfig {
  theme?: string;
  refreshInterval?: number;
  gridColumns?: number;
  gridLayout?: Record<string, unknown>;
  links?: unknown[];
  tabs?: unknown[];
  [key: string]: unknown;
}

/** The merged config object threaded through the app. */
export interface AppConfig extends DisplayConfig {
  nodes?: NodeConfig[];
  services?: Record<string, ServiceOverride>;
}
