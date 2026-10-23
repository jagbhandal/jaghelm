/*
 * The parts of an entity's detail (spec §8, #310): what the desktop's detail
 * drawer and the phone's detail sheet (web look) draw under the status box,
 * in the mock's drawer look. The screens build what goes in them
 * (src/shell/detail/entityExtras.js); these only draw it.
 *
 *  - DetailSection: a part of the detail under an overline heading (11px,
 *    text-3, as the mock's "Heartbeats · last 50"), with a short note at
 *    its end ("3 / 4 running").
 *  - DetailMeters: readings as MetricMeters, two to a row, as the phone's
 *    Node detail draws them; each may carry a caption under it in 12px
 *    text-3 (a storage pool's "412.3 / 900.0 GB · lvmthin").
 *  - DetailVms: a Proxmox node's virtual machines, one per line in a framed
 *    list (the Services list's frame): the name semibold, its size under it,
 *    and what Proxmox says it is doing at the end, in words and never in a
 *    status colour: the status model judges no VM (spec §6), so a stopped VM
 *    is only quieter text.
 *  - DetailSections: a list of sections as the screens build them, each
 *    drawn by its `kind` (facts, meters, vms, or a note).
 *  - DetailUnread: a Banner (no signal's tone) when a read the detail makes
 *    failed: what it couldn't read and why, and that it tries again; what
 *    it read before stays drawn.
 *  - DetailLinks: the mock's row of links under the facts: the primary
 *    button (the thing's own, "Open Immich"), secondary buttons (Grafana,
 *    Uptime Kuma), and a ghost Settings link at the end. A link inside
 *    JagHelm (an embedded app, a Settings page) opens in the page through
 *    `onOpen(href)` on a plain click; another opens as the user's links do
 *    (`target`), with the mock's external-link icon.
 */
import { useId } from 'react';
import { ExternalLink, SlidersHorizontal } from 'lucide-react';
import { Banner } from './banner.jsx';
import { buttonVariants } from './button.jsx';
import { FactList } from './fact-list.jsx';
import { MetricMeter } from './metric-meter.jsx';
import { openHere } from './lib/link.js';
import { cn } from './lib/utils.js';

function DetailSection({ title, aside, children, className, ...props }) {
  const id = useId();
  return (
    <section
      data-slot="detail-section"
      aria-labelledby={id}
      className={cn('flex min-w-0 flex-col gap-2', className)}
      {...props}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={id} className="text-overline text-text-3 uppercase">
          {title}
        </h3>
        {aside && <span className="text-caption text-text-3">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function DetailMeters({ meters = [], className, ...props }) {
  if (!meters.length) return null;
  return (
    <div
      data-slot="detail-meters"
      className={cn('grid grid-cols-2 gap-x-4 gap-y-3', className)}
      {...props}
    >
      {meters.map((m) => (
        <div key={m.key} className="flex min-w-0 flex-col gap-1">
          <MetricMeter
            data-reading={m.key}
            label={m.label}
            value={m.value}
            unit={m.unit}
            max={m.max}
            state={m.state ?? undefined}
            warn={m.warn}
            crit={m.crit}
            band={m.band}
          />
          {m.caption && <span className="text-caption wrap-anywhere text-text-3">{m.caption}</span>}
        </div>
      ))}
    </div>
  );
}

function DetailVms({ vms = [], className, ...props }) {
  if (!vms.length) return null;
  return (
    <ul
      data-slot="detail-vms"
      className={cn(
        'divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-1',
        className
      )}
      {...props}
    >
      {vms.map((vm) => (
        <li key={vm.key} className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="flex min-w-0 flex-col">
            <span className="font-semibold wrap-anywhere text-text-1">{vm.name}</span>
            {vm.detail && <span className="text-caption text-text-3">{vm.detail}</span>}
          </span>
          <span className={cn('shrink-0 text-body-sm', vm.running ? 'text-text-2' : 'text-text-3')}>
            {vm.status}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DetailSections({ sections = [] }) {
  return sections.map((s) => (
    <DetailSection key={s.key} data-section={s.key} title={s.title} aside={s.aside}>
      {s.kind === 'vms' && <DetailVms vms={s.vms} />}
      {s.kind === 'meters' && <DetailMeters meters={s.meters} />}
      {s.facts?.length > 0 && <FactList facts={s.facts} />}
      {s.note && <p className="text-body-sm text-text-2">{s.note}</p>}
    </DetailSection>
  ));
}

/** `unread`: `[{ key, what, error }]`, "the UPS's readings" and "HTTP 502". */
function DetailUnread({ unread = [], ...props }) {
  if (!unread.length) return null;
  const said = unread.map((u) => `${u.what} (${u.error})`).join('; ');
  return (
    <Banner
      data-slot="detail-unread"
      tone="unknown"
      title="Some details aren't updating"
      cause={`JagHelm couldn't read ${said}: it tries again with the next status.`}
      {...props}
    />
  );
}

/** An <a>'s props for a link: in the page through `onOpen`, or out as the user's links open. */
function linkProps(link, { target, onOpen }) {
  if (link.app) {
    return {
      href: link.href,
      onClick: onOpen ? (e) => openHere(e, () => onOpen(link.href)) : undefined,
    };
  }
  return {
    href: link.href,
    target,
    rel: target === '_blank' ? 'noopener noreferrer' : undefined,
  };
}

function Away({ link, target }) {
  if (link.app) return null;
  return (
    <>
      <ExternalLink aria-hidden="true" />
      {target === '_blank' && <span className="sr-only">, opens in a new tab</span>}
    </>
  );
}

function DetailLinks({
  primary = null,
  links = [],
  settings = null,
  target = '_blank',
  onOpen,
  className,
  ...props
}) {
  if (!primary && !links.length && !settings) return null;
  const how = { target, onOpen };
  return (
    <div
      data-slot="detail-links"
      className={cn('flex flex-wrap items-center gap-2', className)}
      {...props}
    >
      {primary && (
        <a
          data-link={primary.key}
          className={cn(buttonVariants({ variant: 'primary' }))}
          {...linkProps(primary, how)}
        >
          {primary.label}
          <Away link={primary} target={target} />
        </a>
      )}
      {links.map((link) => (
        <a
          key={link.key}
          data-link={link.key}
          className={cn(buttonVariants({ variant: 'secondary' }))}
          {...linkProps(link, how)}
        >
          {link.label}
          <Away link={link} target={target} />
        </a>
      ))}
      {settings && (
        <a
          data-link={settings.key}
          className={cn(buttonVariants({ variant: 'ghost' }), 'ml-auto')}
          {...linkProps(settings, how)}
        >
          <SlidersHorizontal aria-hidden="true" />
          {settings.label}
        </a>
      )}
    </div>
  );
}

export { DetailLinks, DetailMeters, DetailSection, DetailSections, DetailUnread, DetailVms };
