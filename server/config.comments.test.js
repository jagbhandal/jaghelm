/**
 * #416: a save edits services.yaml's own document, so its comments and layout
 * stay.
 *
 * Every save that changed something used to rewrite the whole file with
 * js-yaml, so a hand-written file lost every comment, and its quoting and
 * flow lists, on a toggle. Now writeConfig parses the file it is about to
 * replace with the yaml package, edits what changed into that document and
 * writes it back, but only when js-yaml reads the result back as the config
 * being saved. A file the edit can't be trusted on (anchors, aliases or
 * merge keys, a value the two parsers read differently, or an edit that
 * doesn't read back) is rewritten whole as before, with one warn line.
 *
 * These drive the real config module and file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

const { loadConfig, readConfig, saveConfig, writeConfig } = await import('./config.js');

const CONFIG_PATH = join(process.env.JAGHELM_DATA_DIR, 'services.yaml');
const fileText = () => readFileSync(CONFIG_PATH, 'utf8');
/** Put `text` on disk and load it, as the config watcher does after a hand edit. */
function handEdit(text) {
  writeFileSync(CONFIG_PATH, text);
  loadConfig();
}

// What JagHelm writes at the top of a file it writes whole.
const HEADER =
  '# JagHelm Configuration\n# This file is managed by the dashboard. Edit here or in Settings UI — both are equivalent.\n\n';
/** A whole file as JagHelm writes it, on first boot and before #416 on every save. */
const whole = (cfg) =>
  HEADER + yaml.dump(cfg, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false });

// Written by hand: comments above entries and at the end of lines, blank
// lines, quoting JagHelm's writer wouldn't use, flow lists and maps, a block
// string, and every section services.yaml has.
const HAND_WRITTEN = [
  '# My homelab, written by hand.',
  '# Keep these notes.',
  '',
  'nodes:',
  '  # The hypervisor',
  '  pve:',
  '    prometheus_node: pve',
  '    display_name: Proxmox # shown on the board',
  '    subtitle: "Main box"',
  "    icon: '🖥'",
  '    hide: [prometheus, cadvisor] # noisy ones',
  '    visible: true',
  '',
  '  nas:',
  '    display_name: NAS',
  '    port: "8080" # a string, not a number',
  "    flag: 'true'",
  '    notes: |',
  '      Line one.',
  '      Line two.',
  '',
  'services:',
  '  grafana:',
  '    display_name: Grafana',
  "    monitor: Grafana # the Kuma monitor's name",
  '  # sonarr is retired:',
  '  # sonarr:',
  '  #   monitor: Sonarr',
  '',
  'integrations:',
  '  # AdGuard, the primary',
  '  adguard_primary:',
  '    preset: adguard',
  '    instance: primary',
  '    url: http://adguard.example.test:3000',
  '    username: admin',
  '    password: $secret:integration_adguard_primary_password', // pragma: allowlist secret
  '    enabled: true # toggled from Settings',
  '  statuspage:',
  '    url: "http://status.example.test"',
  '    endpoint: /api/summary',
  '    auth: header',
  '    authHeader: X-Api-Key',
  '    token: $secret:statuspage_key', // pragma: allowlist secret
  '    fields:',
  '      - {key: up, label: Up, path: summary.up}',
  '',
  'backupJobs:',
  '  - pve:proxmox-backup # the nightly dump',
  'pushThresholds:',
  '  cpu: {warn: 90}',
  '',
].join('\n');

// Each comment in it, from its `#`.
const COMMENTS = HAND_WRITTEN.split('\n')
  .filter((line) => line.includes('#'))
  .map((line) => line.slice(line.indexOf('#')));

/**
 * `text` with each `[from, to]` line replaced (removed when `to` is null),
 * checking each is there.
 */
function withLines(text, ...changes) {
  let out = text;
  for (const [from, to] of changes) {
    assert.ok(out.includes(`${from}\n`), `the file has the line ${JSON.stringify(from)}`);
    out = out.replace(`${from}\n`, to === null ? '' : `${to}\n`);
  }
  return out;
}

/** Read the file as a route does, change the config with `edit`, write it. */
function saveEdited(edit) {
  const { config, version } = readConfig();
  edit(config);
  const saved = writeConfig(config, version);
  assert.equal(saved.ok, true, 'saved');
  return { config, saved };
}

/** The config module's warn lines written to stderr while `fn` runs, parsed. */
function configWarnings(t, fn) {
  const lines = [];
  t.mock.method(process.stderr, 'write', (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.includes('"level":"warn"') && line.includes('"module":"config"')) {
        lines.push(JSON.parse(line));
      }
    }
    return true;
  });
  try {
    fn();
  } finally {
    t.mock.restoreAll();
  }
  return lines;
}

test('the hand-written fixture holds every kind of value it is meant to', () => {
  const cfg = yaml.load(HAND_WRITTEN);
  assert.equal(cfg.nodes.nas.port, '8080', 'a quoted number is text');
  assert.equal(cfg.nodes.nas.flag, 'true', 'a quoted boolean is text');
  assert.equal(cfg.nodes.nas.notes, 'Line one.\nLine two.\n');
  assert.equal(cfg.integrations.statuspage.token, '$secret:statuspage_key'); // pragma: allowlist secret
  assert.ok(COMMENTS.length >= 10, 'it has comments to lose');
});

// ── A toggle changes only its line ──

test('a toggle on a hand-written, commented services.yaml changes only the enabled line', () => {
  handEdit(HAND_WRITTEN);
  const { saved } = saveEdited((cfg) => {
    cfg.integrations.adguard_primary.enabled = false;
  });
  assert.equal(
    fileText(),
    withLines(HAND_WRITTEN, [
      '    enabled: true # toggled from Settings',
      '    enabled: false # toggled from Settings',
    ])
  );
  for (const comment of COMMENTS) assert.ok(fileText().includes(comment), comment);
  // The version is the one of the bytes written, as for any write (#423).
  assert.equal(readConfig().version, saved.version);
});

test('a new key goes at the end of its mapping and a removed one goes, the rest as it was', () => {
  handEdit(HAND_WRITTEN);
  saveEdited((cfg) => {
    cfg.integrations.statuspage.enabled = false;
    delete cfg.nodes.pve.subtitle;
  });
  const last = '      - {key: up, label: Up, path: summary.up}';
  assert.equal(
    fileText(),
    withLines(
      HAND_WRITTEN,
      ['    subtitle: "Main box"', null],
      [last, `${last}\n    enabled: false`]
    )
  );
});

test('a removed entry goes with the comment right above it, and the next moves up', () => {
  handEdit(HAND_WRITTEN);
  saveEdited((cfg) => {
    delete cfg.nodes.pve;
  });
  const start = HAND_WRITTEN.indexOf('  # The hypervisor\n');
  const end = HAND_WRITTEN.indexOf('  nas:\n');
  assert.equal(fileText(), HAND_WRITTEN.slice(0, start) + HAND_WRITTEN.slice(end));
});

test('a changed list is written anew: the comments around it stay', () => {
  handEdit(HAND_WRITTEN);
  saveEdited((cfg) => {
    cfg.nodes.pve.hide.push('node-exporter');
    cfg.backupJobs = ['pve:proxmox-backup', 'nas:nas-b2-backup'];
  });
  assert.equal(
    fileText(),
    withLines(
      HAND_WRITTEN,
      [
        '    hide: [prometheus, cadvisor] # noisy ones',
        '    hide: [prometheus, cadvisor, node-exporter] # noisy ones',
      ],
      ['  - pve:proxmox-backup # the nightly dump', '  - pve:proxmox-backup\n  - nas:nas-b2-backup']
    )
  );
});

// ── Lines the save leaves alone stay as they were ──

test('a toggle leaves every flow and block list and mapping as it was', () => {
  const text = [
    'nodes:',
    '  pve:',
    '    hide: [prometheus, cadvisor]',
    '    tags: []',
    '    extra: {}',
    '    style: {color: blue, size: 2}',
    '    nested: {list: [1, 2], map: {k: v}}',
    '    ports:',
    '      - 80',
    '      - 443',
    '    labels:',
    '      a: b',
    '    visible: true',
    '',
  ].join('\n');
  handEdit(text);
  saveEdited((cfg) => {
    cfg.nodes.pve.visible = false;
  });
  assert.equal(fileText(), withLines(text, ['    visible: true', '    visible: false']));
});

test('a long quoted or plain value on a line the save leaves alone is not folded', () => {
  const long = 'word '.repeat(45).trim(); // 224 characters
  const text = [
    'nodes:',
    '  pve:',
    `    double: "${long}"`,
    `    single: '${long}'`,
    `    plain: ${long}`,
    `    url: "http://pve.example.test/${'a'.repeat(200)}"`,
    '    visible: true',
    '',
  ].join('\n');
  handEdit(text);
  saveEdited((cfg) => {
    cfg.nodes.pve.visible = false;
  });
  assert.equal(fileText(), withLines(text, ['    visible: true', '    visible: false']));
});

// ── A removed key takes its own comment; a section's heading stays ──

// The comment right above a key is its own. One a blank line above it, a
// section's heading or the file's header, belongs to no one key.
const SECTIONS = [
  '# My homelab.',
  '',
  '# The machines',
  'nodes: # every box',
  '  # Hypervisors',
  '',
  '  # The big one',
  '  pve:',
  '    display_name: Proxmox',
  '  # The NAS',
  '  nas:',
  '    display_name: NAS',
  '',
  '  # Small boxes',
  '',
  '  # The mini PC',
  '  mini:',
  '    display_name: Mini',
  '  pi:',
  '    display_name: Pi',
  'services: {}',
  '',
  '# Thresholds',
  '',
  '# CPU only',
  'pushThresholds:',
  '  cpu: {warn: 90}',
  '',
].join('\n');

// Each removal, and what goes from the file with it.
const REMOVALS = [
  {
    name: 'the first key of a mapping, under a section heading',
    edit: (cfg) => delete cfg.nodes.pve,
    cut: '  # The big one\n  pve:\n    display_name: Proxmox\n',
  },
  {
    name: 'a key in the middle of a mapping, with no heading above',
    edit: (cfg) => delete cfg.nodes.nas,
    cut: '  # The NAS\n  nas:\n    display_name: NAS\n',
  },
  {
    name: 'a key in the middle of a mapping, under a section heading',
    edit: (cfg) => delete cfg.nodes.mini,
    cut: '  # The mini PC\n  mini:\n    display_name: Mini\n',
  },
  {
    name: 'the first key of the file, under the file header',
    edit: (cfg) => delete cfg.nodes,
    cut: SECTIONS.slice(SECTIONS.indexOf('# The machines'), SECTIONS.indexOf('services: {}')),
  },
  {
    name: 'the last key of the file, under a section heading',
    edit: (cfg) => delete cfg.pushThresholds,
    cut: '\n# CPU only\npushThresholds:\n  cpu: {warn: 90}\n',
  },
];

for (const { name, edit, cut } of REMOVALS) {
  test(`removing ${name} takes its own comment and leaves the heading above it`, () => {
    handEdit(SECTIONS);
    saveEdited(edit);
    assert.ok(SECTIONS.includes(cut));
    assert.equal(fileText(), SECTIONS.replace(cut, ''));
  });
}

test("a comment on a key's line stays on it, and a header right above a removed key goes with it", () => {
  handEdit(SECTIONS);
  saveEdited((cfg) => {
    cfg.nodes.pi.display_name = 'Raspberry Pi';
  });
  assert.equal(
    fileText(),
    withLines(SECTIONS, ['    display_name: Pi', '    display_name: Raspberry Pi'])
  );

  // No blank line between it and the key: the comment is the key's own.
  handEdit('# The machines\nnodes:\n  pve: {}\nservices: {}\n');
  saveEdited((cfg) => delete cfg.nodes);
  assert.equal(fileText(), 'services: {}\n');
});

test('a mapping whose keys are all removed is written `{}`, as js-yaml writes it', () => {
  handEdit('nodes:\n  # The big one\n  pve:\n    display_name: Proxmox\nservices: {}\n');
  saveEdited((cfg) => {
    cfg.nodes = {};
  });
  assert.equal(fileText(), 'nodes: {}\nservices: {}\n');
});

// ── Every value round-trips ──

test('$secret: references, quoted look-alikes, multi-line strings and every section round-trip', () => {
  handEdit(HAND_WRITTEN);
  const { config } = saveEdited((cfg) => {
    cfg.nodes.pve.display_name = 'Proxmox VE';
    // New values of each awkward kind, written into the hand-written file.
    cfg.nodes.mini = {
      port: '9100',
      flag: 'false',
      empty: '',
      nothing: null,
      notes: 'First.\nSecond.\n',
      colon: 'a: b # not a comment',
    };
    cfg.integrations.npm = { password: '$secret:integration_npm_password' }; // pragma: allowlist secret
  });
  const back = yaml.load(fileText());
  assert.deepEqual(back, config, 'js-yaml reads back exactly what was saved');
  assert.equal(back.nodes.nas.port, '8080');
  assert.equal(back.nodes.nas.flag, 'true');
  assert.equal(back.nodes.mini.port, '9100');
  assert.equal(back.nodes.mini.flag, 'false');
  assert.equal(back.nodes.nas.notes, 'Line one.\nLine two.\n');
  assert.equal(back.integrations.statuspage.token, '$secret:statuspage_key'); // pragma: allowlist secret
  assert.equal(back.integrations.npm.password, '$secret:integration_npm_password'); // pragma: allowlist secret
  assert.deepEqual(back.backupJobs, ['pve:proxmox-backup']);
  assert.deepEqual(back.pushThresholds, { cpu: { warn: 90 } });

  // Byte for byte: the changed line, and the new entries at the end of theirs.
  const last = '      - {key: up, label: Up, path: summary.up}';
  const mini = [
    '      Line two.',
    '  mini:',
    "    port: '9100'",
    "    flag: 'false'",
    "    empty: ''",
    '    nothing: null',
    '    notes: |',
    '      First.',
    '      Second.',
    "    colon: 'a: b # not a comment'",
  ].join('\n');
  const npm = `${last}\n  npm:\n    password: $secret:integration_npm_password`; // pragma: allowlist secret
  assert.equal(
    fileText(),
    withLines(
      HAND_WRITTEN,
      [
        '    display_name: Proxmox # shown on the board',
        '    display_name: Proxmox VE # shown on the board',
      ],
      ['      Line two.', mini],
      [last, npm]
    )
  );
});

test('a file JagHelm wrote is written back byte for byte apart from the change', () => {
  rmSync(CONFIG_PATH, { force: true });
  const generated = {
    nodes: {
      pve: {
        prometheus_node: 'pve',
        display_name: 'pve',
        subtitle: '',
        icon: '🖥',
        border_color: '#6366f1',
        // Longer than yaml's own 80-column fold, shorter than the 120 JagHelm folds at.
        notes:
          'The main host in the rack: it runs the Docker VM, the staging VM and the home automation one.',
        // Over 120 columns: js-yaml folds the first as `>-`, quotes the second
        // ("\t") on one line. Both come back as they were.
        about: 'The rack holds it all. '.repeat(10).trim(),
        tabbed: `Columns:\t${'one two three '.repeat(12).trim()}`,
        visible: true,
        auto_discover: true,
        hide: ['prometheus', 'node-exporter', 'cadvisor'],
      },
    },
    services: {},
    integrations: {
      adguard_primary: {
        preset: 'adguard',
        instance: 'primary',
        url: 'http://adguard.example.test:3000',
        password: '$secret:integration_adguard_primary_password', // pragma: allowlist secret
        enabled: true,
      },
    },
  };
  // First boot writes the whole file, with JagHelm's header.
  assert.equal(saveConfig(generated), true);
  const before = fileText();
  assert.equal(before, whole(generated));

  const { config } = saveEdited((cfg) => {
    cfg.integrations.adguard_primary.enabled = false;
  });
  assert.equal(fileText(), withLines(before, ['    enabled: true', '    enabled: false']));
  // And it is what the whole rewrite would have written: so for a file JagHelm
  // wrote, keeping the file's own layout changes nothing.
  assert.equal(fileText(), whole(config));

  const next = saveEdited((cfg) => {
    cfg.services.grafana = { monitor: 'Grafana' };
    cfg.nodes.pve.hide = ['prometheus'];
    cfg.integrations.npm = { url: 'http://npm.example.test', enabled: true };
  });
  assert.equal(fileText(), whole(next.config));
});

// ── The header ──

test("an edit keeps the file's own top comment and never adds JagHelm's header", () => {
  handEdit(HAND_WRITTEN);
  saveEdited((cfg) => {
    cfg.nodes.nas.display_name = 'Storage';
  });
  assert.ok(
    fileText().startsWith('# My homelab, written by hand.\n# Keep these notes.\n\nnodes:\n')
  );
  assert.equal(fileText().includes('JagHelm Configuration'), false);

  // A file with no comment at all gets none.
  handEdit('nodes:\n  a: {}\n');
  saveEdited((cfg) => {
    cfg.nodes.b = { display_name: 'B' };
  });
  assert.equal(fileText(), 'nodes:\n  a: {}\n  b:\n    display_name: B\n');

  // A file JagHelm wrote keeps its one header.
  rmSync(CONFIG_PATH, { force: true });
  assert.equal(saveConfig({ nodes: {} }), true);
  saveEdited((cfg) => {
    cfg.nodes.c = {};
  });
  assert.equal(fileText(), `${HEADER}nodes:\n  c: {}\n`);
});

// ── The fallback: the whole file, as before, said once ──

// Each is a file the edit can't be trusted on, why, and a change to save.
const FALLBACKS = [
  {
    name: 'an anchor and an alias',
    reason: 'aliases',
    text: [
      '# Shared settings',
      'defaults: &node { visible: true, icon: "🖥" }',
      'nodes:',
      '  pve: *node',
      'integrations:',
      '  adguard:',
      '    url: http://adguard.example.test:3000',
      '    password: $secret:integration_adguard_password # kept', // pragma: allowlist secret
      '',
    ].join('\n'),
    edit: (cfg) => {
      cfg.integrations.adguard.enabled = false;
    },
  },
  {
    name: 'a merge key',
    reason: 'aliases',
    text: [
      '# Merged',
      'nodes:',
      '  pve:',
      '    <<: { visible: true }',
      '    display_name: Proxmox # here',
      '',
    ].join('\n'),
    edit: (cfg) => {
      cfg.nodes.pve.display_name = 'Proxmox VE';
    },
  },
  {
    name: 'a value the two parsers read differently (a date)',
    reason: 'parsers',
    text: '# Dated\nnodes:\n  pve:\n    since: 2026-10-22 # a date to js-yaml, text to yaml\n',
    edit: (cfg) => {
      cfg.nodes.pve.display_name = 'Proxmox';
    },
  },
  {
    name: 'a line the yaml package refuses and js-yaml reads (no space before a comment)',
    reason: 'parsers',
    text: '# Spacing\nnodes:\n  pve:\n    hide: [ prometheus, cadvisor ]# noisy ones\n',
    edit: (cfg) => {
      cfg.nodes.pve.display_name = 'Proxmox';
    },
  },
  {
    name: "an edit that doesn't read back (text that looks like a date)",
    reason: 'roundTrip',
    text: '# Plain\nnodes:\n  pve:\n    subtitle: Main box # here\n',
    edit: (cfg) => {
      cfg.nodes.pve.subtitle = '2026-10-22';
    },
  },
];

// Every value in the files above, none of which a warn line may name.
const VALUES = [
  'adguard.example.test',
  '$secret:',
  'integration_adguard_password',
  'Proxmox',
  'Main box',
  '2026-10-22',
  '🖥',
];

for (const { name, reason, text, edit } of FALLBACKS) {
  test(`a file with ${name} still saves, rewritten whole, with one warn line that names no value`, (t) => {
    handEdit(text);
    let saved;
    const warnings = configWarnings(t, () => {
      saved = saveEdited(edit);
    });
    // Today's rewrite, header and all: the values are right, the comments go.
    assert.equal(fileText(), whole(saved.config));
    assert.deepEqual(yaml.load(fileText()), saved.config);
    assert.equal(warnings.length, 1, JSON.stringify(warnings));
    assert.equal(warnings[0].reason, reason);
    assert.match(warnings[0].msg, /comments were not kept/);
    const line = JSON.stringify(warnings[0]);
    for (const value of VALUES) assert.equal(line.includes(value), false, `no ${value}`);
  });
}

test('a value saved in two places is written out twice, never as an anchor and an alias', () => {
  handEdit(HAND_WRITTEN);
  const shared = { visible: true };
  saveEdited((cfg) => {
    cfg.nodes.twins = { left: shared, right: shared };
  });
  const text = fileText();
  assert.equal(
    text.slice(text.indexOf('  twins:\n'), text.indexOf('\nservices:')),
    '  twins:\n    left:\n      visible: true\n    right:\n      visible: true\n'
  );
});

test('an in-place save logs nothing at warn', (t) => {
  handEdit(HAND_WRITTEN);
  const warnings = configWarnings(t, () => {
    saveEdited((cfg) => {
      cfg.integrations.adguard_primary.enabled = false;
    });
  });
  assert.deepEqual(warnings, []);
});
