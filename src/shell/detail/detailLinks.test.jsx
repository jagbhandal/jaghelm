import { describe, it, expect } from 'vitest';
import { entityLinks } from './detailLinks.js';

// The detail's links (#310): only the user's own apps and Quick Launch links,
// by their exact name, never an icon; an ambiguous name gives no link, and
// what is one per node must name its node.

const app = (id, label, url) => ({ id, label, type: 'iframe', url });
const link = (name, url, icon) => ({ name, url, ...(icon && { icon }) });

const node = (key, name) => ({ id: `nodes/${key}`, kind: 'node', node: key, name });
const service = (node, container, name) => ({
  id: `services/${node}:${container}`,
  kind: 'service',
  node,
  name,
});
const status = (...entities) => ({ entities });

const hrefOf = (links, key) =>
  [links.primary, ...links.links].find((l) => l?.key === key)?.href ?? null;

describe('entityLinks: by exact name, never by icon (#310)', () => {
  it('"Proxmox Backup Server" with Proxmox’s icon is not Proxmox', () => {
    const pve = node('pve', 'Hypervisor');
    const config = {
      links: { admin: [link('Proxmox Backup Server', 'https://pbs.example.com', 'proxmox')] },
    };
    const links = entityLinks({ entity: pve, status: status(pve), proxmox: true, config });
    expect(hrefOf(links, 'proxmox')).toBeNull();
  });

  it('two of a name at different addresses give none; an app and a link to one address are one, the app', () => {
    const pve = node('pve', 'Hypervisor');
    const two = {
      tabs: [app('proxmox', 'Proxmox pve', 'https://pve.example.com')],
      links: { admin: [link('Proxmox pve', 'https://pve.other.example.com')] },
    };
    expect(
      hrefOf(entityLinks({ entity: pve, status: status(pve), proxmox: true, config: two }), 'proxmox')
    ).toBeNull();

    const one = {
      tabs: [app('proxmox', 'Proxmox pve', 'https://pve.example.com')],
      links: { admin: [link(' PROXMOX PVE ', 'https://pve.example.com')] },
    };
    const links = entityLinks({ entity: pve, status: status(pve), proxmox: true, config: one });
    expect(links.primary).toEqual({
      key: 'proxmox',
      label: 'Open Proxmox',
      href: '/apps/proxmox',
      app: true,
    });
  });
});

describe('entityLinks: what is one per node names its node (#310)', () => {
  const pve1 = node('pve1', 'Hypervisor 1');
  const pve2 = node('pve2', 'Hypervisor 2');
  const both = status(pve1, pve2);

  it('two Proxmox nodes: a plain "Proxmox" opens neither; "Proxmox pve2" opens pve2’s alone', () => {
    const plain = { links: { admin: [link('Proxmox', 'https://pve1.example.com:8006')] } };
    for (const n of [pve1, pve2]) {
      expect(
        hrefOf(entityLinks({ entity: n, status: both, proxmox: true, config: plain }), 'proxmox')
      ).toBeNull();
    }
    const named = {
      links: {
        admin: [
          link('Proxmox pve1', 'https://pve1.example.com:8006'),
          link('Proxmox (Hypervisor 2)', 'https://pve2.example.com:8006'),
        ],
      },
    };
    const of = (n) => entityLinks({ entity: n, status: both, proxmox: true, config: named });
    expect(of(pve1).primary).toMatchObject({
      label: 'Open Proxmox',
      href: 'https://pve1.example.com:8006',
    });
    expect(of(pve2).primary).toMatchObject({
      label: 'Open Proxmox',
      href: 'https://pve2.example.com:8006',
    });
  });

  it('a node named "Proxmox" opens its link of that name', () => {
    const pve = node('pve', 'Proxmox');
    const config = { links: { admin: [link('Proxmox', 'https://pve.example.com:8006')] } };
    expect(
      hrefOf(entityLinks({ entity: pve, status: status(pve), proxmox: true, config }), 'proxmox')
    ).toBe('https://pve.example.com:8006');
  });

  it('a container on two nodes: its plain name opens neither; one named with its node opens that one', () => {
    const edge = service('edge', 'cadvisor', 'cAdvisor');
    const storage = service('storage', 'cadvisor', 'cAdvisor');
    const model = status(edge, storage);
    const card = { container: 'cadvisor', monitored: true };
    const plain = { links: { tools: [link('cAdvisor', 'https://edge.example.com:8080')] } };
    for (const s of [edge, storage]) {
      expect(
        hrefOf(entityLinks({ entity: s, status: model, card, config: plain }), 'open')
      ).toBeNull();
    }
    const named = {
      links: {
        tools: [
          link('cAdvisor edge', 'https://edge.example.com:8080'),
          link('cadvisor (Storage)', 'https://nas.example.com:8080'),
        ],
      },
    };
    const of = (s, nodeName) =>
      hrefOf(entityLinks({ entity: s, status: model, card, nodeName, config: named }), 'open');
    expect(of(edge, 'Network Edge')).toBe('https://edge.example.com:8080');
    expect(of(storage, 'Storage')).toBe('https://nas.example.com:8080');
  });

  it('a service only one node runs opens its link by its own name or its container’s', () => {
    const immich = service('vm103', 'immich-server', 'Immich');
    const config = { links: { media: [link('immich', 'https://photos.example.com')] } };
    const links = entityLinks({
      entity: immich,
      status: status(immich, service('vm101', 'gitea', 'Gitea')),
      card: { container: 'immich-server', monitored: true },
      config,
    });
    expect(links.primary).toMatchObject({
      key: 'open',
      label: 'Open Immich',
      href: 'https://photos.example.com',
    });
  });
});
