/**
 * The config with app tab `id`'s "show it anyway" choice set (`embedAnyway:
 * true`) or cleared (the key removed), #445. The same flag Settings → Apps &
 * links sets. Pure.
 */
export function withEmbedAnyway(config, id, on) {
  return {
    ...config,
    tabs: (config.tabs || []).map((t) => {
      if (String(t?.id) !== String(id)) return t;
      if (on) return { ...t, embedAnyway: true };
      const { embedAnyway: _off, ...rest } = t;
      return rest;
    }),
  };
}
