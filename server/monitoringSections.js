/**
 * The Monitoring page's sections (#751, spec §5 "Layout"), in page order: a
 * plain-language heading that names what its charts answer. Pure data, apart
 * from monitoring.js (which reads Prometheus) so the page, in the web
 * client's lazy chunk, can import it without the server's modules. Every
 * chart in the server's table (MONITORING_CHARTS) names one of these by `id`.
 */
export const MONITORING_SECTIONS = Object.freeze(
  [
    { id: 'power-cost', title: 'Power and cost', question: 'What does the lab draw, and what does it cost?' },
    { id: 'capacity', title: 'Capacity', question: 'Which disk fills first?' },
    { id: 'resources', title: 'Resources', question: 'Is any node short of CPU, memory or bandwidth?' },
    { id: 'containers', title: 'Containers', question: 'Which container leaks, and what restarted?' },
    { id: 'drives', title: 'Drives', question: 'Are the drives healthy?' },
  ].map((s) => Object.freeze(s))
);

/** The ids of the sections, in order. */
export const SECTION_IDS = Object.freeze(MONITORING_SECTIONS.map((s) => s.id));
