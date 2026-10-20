/**
 * Test-only (#470): JagHelm booting while Prometheus has just started, as when
 * a host reboot brings both containers up together. Prometheus knows the
 * homelab's targets (testing/mockPrometheus.js) and has scraped none of them,
 * so every query answers with no series; `scrape()` makes it scrape them all.
 *
 * Its tests each run in a test file of their own, so the refreshes start from
 * nothing, as on a boot: what refresh.js keeps in memory is new.
 */
import { getConfig, saveConfig } from '../config.js';
import { getNodesData, initDiscovery } from '../discovery.js';
import { assembleServices } from '../refresh.js';
import { createMockPrometheus, homelabSeries, targetsOf } from './mockPrometheus.js';
import { cachesOfAssembled } from './pushPipeline.js';

/**
 * The homelab's nodes in services.yaml, behind a mock Prometheus that has
 * scraped nothing yet. Install `mock.fetch` as globalThis.fetch.
 */
export function coldHomelab({ nodes = 6 } = {}) {
  const { labels, series } = homelabSeries({ nodes });
  const mock = createMockPrometheus([]);
  mock.targets = targetsOf(series, { scraped: false });
  initDiscovery(mock.url);
  saveConfig({ nodes: Object.fromEntries(labels.map((l) => [l, { display_name: l }])), services: {} });
  return {
    labels,
    mock,
    /** Prometheus scrapes every target: the series are there, and the targets healthy. */
    scrape() {
      mock.series = series;
      mock.targets = null;
    },
    /**
     * One cycle's caches with every target scraped, built from discovery and
     * assembleServices without the refresh loop: what the JagHelm that ran
     * before the reboot read.
     */
    async scrapedCaches() {
      const scraped = createMockPrometheus(series, { url: mock.url });
      const fetch = globalThis.fetch;
      globalThis.fetch = scraped.fetch;
      try {
        const config = getConfig();
        const byLabel = await getNodesData(labels);
        return cachesOfAssembled(
          assembleServices({
            nodeResults: labels.map((l) => [l, config.nodes[l], byLabel.get(l)]),
            monitors: {},
            config,
            lastSeenNodeOf: () => null,
            containerRegistry: null,
          })
        );
      } finally {
        globalThis.fetch = fetch;
      }
    },
  };
}
