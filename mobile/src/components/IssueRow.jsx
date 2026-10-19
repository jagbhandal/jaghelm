/**
 * IssueRow — one row in the Active-issues list on the Overview screen.
 *
 * Props:
 *   incident  {id,kind,title,node,cause,severity,word,shape,readout,target,…}
 *             — from deriveIncidents(). All presentational fields are
 *             pre-derived; this component is a pure renderer.
 *   onOpen    function (optional) — called with no argument when the row is
 *             tapped; the caller knows where the row leads (Overview builds the
 *             route with nav/issueRoute.js). With it the row is a button named
 *             "{title}, {word}, {readout}", with an abbreviated word spelled out
 *             for screen readers (UNKN → unknown); without it (nothing to open)
 *             the row is plain content, so it neither looks nor announces as
 *             tappable (#279).
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

// The accessible name speaks a whole word where the visible label abbreviates
// it, so TalkBack doesn't spell out "UNKN".
const SPOKEN_WORD = { UNKN: 'unknown' };

export default function IssueRow({ incident, onOpen }) {
  const showCause = incident.severity === 'critical' && Boolean(incident.cause);
  const className = `issue-row issue-row--${incident.severity}`;

  const content = (
    <>
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
    </>
  );

  if (!onOpen) return <div className={className}>{content}</div>;

  // One clean name instead of the lamp label + word + text run together.
  const word = SPOKEN_WORD[incident.word] ?? incident.word;
  const name = [incident.title, word, incident.readout].filter(Boolean).join(', ');

  return (
    <button
      type="button"
      className={className}
      onClick={() => onOpen()}
      aria-label={name}
    >
      {content}
    </button>
  );
}
