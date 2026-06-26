/**
 * Data hook stub — implemented in Task 4.
 * MobileApp imports this; tests mock it via vi.mock('./data/useDashboard.js').
 */
export function useDashboard() {
  return { servicesBody: { nodes: {} }, ups: {}, cron: [], history: {}, loading: true, error: null };
}
