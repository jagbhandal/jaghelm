/**
 * Find nodes (#572): Settings → Nodes asks Prometheus for its nodes now and
 * offers the ones services.yaml doesn't have.
 *
 * A first boot names the nodes once (firstBoot.js); a file saved before it
 * found any, or written by hand, is the user's and is never discovered over,
 * so without this the only way to a node was a hand edit. This reuses the
 * first boot's discovery (discoverNodes) and its node shape
 * (generateDefaultConfig), so a node found here is the one a first boot would
 * have written: its key is the Prometheus label (the `node` label, else the
 * `instance` one) and its settings the defaults.
 *
 * It only looks. It writes nothing and removes or renames nothing: Settings
 * adds what it returns with its ordinary save, over the version it read.
 */
import { discoverNodes } from './discovery.js';
import { generateDefaultConfig } from './config.js';

/**
 * Whether `config` already has a node for Prometheus label `label`: one keyed
 * by it, or one whose `prometheus_node` is it (a node kept under another
 * spelling). A node hidden (`visible: false`) is still the file's.
 */
function hasNodeFor(config, label) {
  const nodes = config?.nodes;
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) return false;
  if (Object.hasOwn(nodes, label)) return true;
  return Object.values(nodes).some((n) => n && typeof n === 'object' && n.prometheus_node === label);
}

/**
 * The nodes Prometheus knows that `config` doesn't have, as `{ key: node }`
 * in a first boot's shape. Rejects as discoverNodes does when Prometheus
 * can't be asked.
 */
export async function findNewNodes(config) {
  const labels = [...new Set(await discoverNodes())].filter((l) => !hasNodeFor(config, l));
  return generateDefaultConfig(labels.sort()).nodes;
}
