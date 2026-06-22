/**
 * JagHelm Icon Index
 * 
 * Fetches icon listings from multiple GitHub icon repositories at boot,
 * caches them in memory, and provides a search API.
 * 
 * Sources:
 * - homarr-labs/dashboard-icons (primary, ~1800+ icons)
 * - selfhst/icons (~200+ self-hosted app icons)
 *
 * Icons are served via jsDelivr CDN — we only store the names.
 */

import { createLogger } from './util/logger.js';

const log = createLogger('icons');

const ICON_REPOS = [
  {
    id: 'dashboard-icons',
    label: 'Dashboard Icons',
    repo: 'homarr-labs/dashboard-icons',
    branch: 'main',
    treePath: 'svg/',
    cdnBase: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg',
    ext: '.svg',
  },
  {
    id: 'selfhst',
    label: 'selfh.st Icons',
    repo: 'selfhst/icons',
    branch: 'main',
    treePath: 'svg/',
    cdnBase: 'https://cdn.jsdelivr.net/gh/selfhst/icons@latest/svg',
    ext: '.svg',
  },
];

// In-memory icon index: [{ name, slug, url, repo }]
let iconIndex = [];
let indexReady = false;

/**
 * Fetch icon listing from a GitHub repo's git tree API.
 * Returns array of { name, slug, url, repo }
 */
async function fetchRepoIcons(repoConfig) {
  const { id, label, repo, branch, treePath, cdnBase, ext } = repoConfig;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(
      `https://api.github.com/repos/${repo}/git/trees/${branch || 'main'}?recursive=true`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'JagHelm/8.0',
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!res.ok) {
      log.warn({ status: res.status, repo }, 'GitHub API returned error');
      return [];
    }

    const data = await res.json();
    const tree = data.tree || [];

    // Flat structure: svg/{icon-name}.svg
    return tree
      .filter(item => item.type === 'blob' && item.path.startsWith(treePath) && item.path.endsWith(ext))
      .map(item => {
        const filename = item.path.slice(treePath.length);
        const slug = filename.replace(ext, '');
        const name = slug
          .replace(/-/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());
        return {
          name,
          slug,
          url: `${cdnBase}/${filename}`,
          repo: id,
          repoLabel: label,
        };
      });
  } catch (err) {
    log.warn({ err, repo }, 'Failed to fetch icons');
    return [];
  }
}

/**
 * Initialize the icon index at boot.
 * Fetches all repos in parallel, deduplicates by slug, sorts alphabetically.
 */
export async function initIconIndex() {
  log.info({ count: ICON_REPOS.length }, 'Fetching icon listings from repositories...');

  const results = await Promise.allSettled(
    ICON_REPOS.map(repo => fetchRepoIcons(repo))
  );

  const all = [];
  const seen = new Set();

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const icon of result.value) {
        // Deduplicate: prefer dashboard-icons > selfhst (fetch order)
        if (!seen.has(icon.slug)) {
          seen.add(icon.slug);
          all.push(icon);
        }
      }
    }
  }

  all.sort((a, b) => a.name.localeCompare(b.name));
  iconIndex = all;
  indexReady = true;
  log.info({ count: iconIndex.length, repositories: ICON_REPOS.length }, 'Indexed unique icons from repositories');
}

/**
 * Search icons by query string.
 * Returns up to `limit` matching icons.
 */
export function searchIcons(query, limit = 50) {
  if (!indexReady) return [];
  if (!query || query.length < 1) {
    // Return first N icons if no query
    return iconIndex.slice(0, limit);
  }

  const q = query.toLowerCase();
  const results = [];

  for (const icon of iconIndex) {
    if (results.length >= limit) break;
    if (icon.slug.includes(q) || icon.name.toLowerCase().includes(q)) {
      results.push(icon);
    }
  }

  return results;
}

/**
 * Get total icon count.
 */
export function getIconCount() {
  return iconIndex.length;
}

/**
 * Check if index is loaded.
 */
export function isIconIndexReady() {
  return indexReady;
}
