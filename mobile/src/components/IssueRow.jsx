/**
 * IssueRow — one row in the Active-issues list on the Overview screen.
 *
 * Props:
 *   incident  {id,kind,title,node,cause,severity,word,shape,readout,target,…}
 *             — from deriveIncidents(). All presentational fields are
 *             pre-derived; this component is a pure renderer.
 *   onOpen    function (optional) — called when the row is tapped with
 *             `incident.target` as the argument.
 *
 * Honest-numbers rule (spec §7.2):
 *   `incident.readout` is passed through verbatim. This component NEVER
 *   synthesizes a time, age, or duration string. The readout is already
 *   built by deriveIncidents:
 *     service-down  → '{node}'              (node name only, no age)
 *     UPS           → '{charge}% · {runtime}'
 *     cron          → '{node}'
 *     unknown       → '{node} · no signal'
 *
 * Cause line rule (spec §7.2):
 *   The prose `incident.cause` is shown ONLY for critical (down) rows.
 *   For caution (UPS/cron) and unknown rows the cause lives in the detail
 *   view; the row is deliberately compact.
 *
 * CSS: styles in MobileApp.css under `#mobile-root .issue-row`.
 */
import StatusLamp from './StatusLamp.jsx';
import StatusWord from './StatusWord.jsx';

export default function IssueRow({ incident, onOpen }) {
  const showCause = incident.severity === 'critical' && Boolean(incident.cause);

  function handleClick() {
    if (onOpen) onOpen(incident.target);
  }

  return (
    <button
      type="button"
      className={`issue-row issue-row--${incident.severity}`}
      onClick={handleClick}
    >
      <div className="issue-row__main">
        <StatusLamp
          shape={incident.shape}
          severity={incident.severity}
          label={incident.word}
          size={14}
        />
        <StatusWord word={incident.word} severity={incident.severity} />
        <span className="issue-row__name">{incident.title}</span>
        <span className="issue-row__readout">{incident.readout}</span>
      </div>

      {/* Prose cause — only for critical/down rows (spec §7.2) */}
      {showCause && (
        <p className="issue-row__cause">{incident.cause}</p>
      )}
    </button>
  );
}
