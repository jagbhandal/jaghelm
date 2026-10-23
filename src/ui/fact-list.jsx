/*
 * FactList (spec §5.4, §8; #288): an entity's facts as label and value, the
 * mock's detail-drawer list: a UPS's charge, runtime, load and input; a
 * service's monitor, latency, uptime and host; an integration's stats (#310).
 * Spec §5.4 calls it StatStrip; the mock draws it as this list on both its
 * Overview and Phone boards, and has no strip of figures.
 *
 * Two columns: the label in `text-3`, the value semibold in `text-1`, 10px
 * between rows and 12px between columns. From 384px of its own width it
 * is the Overview drawer's (a 130px label column, 13px, the mock's 20px
 * lines); narrower, the Phone board's detail screen (120px, 14px). A value
 * may be any node (a host in mono, a status word); a label wraps in its
 * column, a value in its own, and a value with no break in it (a URL, a SHA,
 * a hostname) breaks anywhere rather than run past it (#289).
 *
 * It is a description list: each label a term, each value its definition.
 * Without facts it renders nothing. `muted` draws the values in text-2: the
 * last known ones of a stale status (#310, #480).
 */
import { Fragment } from 'react';
import { cn } from './lib/utils.js';

function FactList({ facts = [], muted = false, className, ...props }) {
  if (!facts.length) return null;
  return (
    <div className={cn('@container', className)} {...props}>
      <dl
        data-slot="fact-list"
        data-muted={muted ? '' : undefined}
        className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-body @sm:grid-cols-[130px_minmax(0,1fr)] @sm:text-body-sm @sm:leading-5"
      >
        {facts.map((f) => (
          <Fragment key={f.key}>
            <dt className="text-text-3">{f.label}</dt>
            <dd
              className={cn(
                'min-w-0 font-semibold wrap-anywhere',
                muted ? 'text-text-2' : 'text-text-1'
              )}
            >
              {f.value}
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

export { FactList };
