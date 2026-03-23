/**
 * JagHelm Icon Index
 * 
 * Fetches icon listings from multiple GitHub icon repositories at boot,
 * caches them in memory, and provides a search API.
 * 
 * Sources (same as Homarr):
 * - homarr-labs/dashboard-icons (primary, ~1800+ icons)
 * - selfhst/icons (~200+ self-hosted app icons)
 * - simple-icons/simple-icons (~2500+ brand icons)
 * 
 * Icons are served via jsDelivr CDN — we only store the names.
 */

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
  const { id, label, repo, branch, treePath, cdnBase, ext, isNested, nestedFile } = repoConfig;
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
      console.warn(`[icons] GitHub API returned ${res.status} for ${repo}`);
      return [];
    }

    const data = await res.json();
    const tree = data.tree || [];

    if (isNested && nestedFile) {
      // Nested structure: svg/{icon-name}/outline.svg
      // Find all files matching the pattern svg/*/nestedFile
      const targetSuffix = `/${nestedFile}`;
      return tree
        .filter(item => item.type === 'blob' && item.path.startsWith(treePath) && item.path.endsWith(targetSuffix))
        .map(item => {
          // Extract icon name from path: svg/home/outline.svg → home
          const withoutPrefix = item.path.slice(treePath.length);
          const slug = withoutPrefix.split('/')[0];
          const name = slug
            .replace(/_/g, ' ')
            .replace(/-/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
          return {
            name,
            slug,
            url: `${cdnBase}/${slug}/${nestedFile}`,
            repo: id,
            repoLabel: label,
          };
        });
    }

    // Standard flat structure: svg/{icon-name}.svg
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
    console.warn(`[icons] Failed to fetch icons from ${repo}:`, err.message);
    return [];
  }
}

/**
 * Initialize the icon index at boot.
 * Fetches all repos in parallel, deduplicates by slug, sorts alphabetically.
 */
export async function initIconIndex() {
  console.log('[icons] Fetching icon listings from %d repositories...', ICON_REPOS.length);

  const results = await Promise.allSettled(
    ICON_REPOS.map(repo => fetchRepoIcons(repo))
  );

  const all = [];
  const seen = new Set();

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const icon of result.value) {
        // Deduplicate: prefer dashboard-icons > selfhst > simple-icons
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
  console.log('[icons] Indexed %d unique icons from %d repositories', iconIndex.length, ICON_REPOS.length);
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
