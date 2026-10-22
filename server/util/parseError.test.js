/**
 * #504: a parse error is logged and answered as its reason and position only.
 *
 * js-yaml's message shows the lines around the bad one (`mark.snippet`) and
 * its `mark.buffer` is the whole file; V8's JSON.parse error quotes the text
 * near the bad token. Neither may reach the log (and Loki) or a response.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';

import {
  yamlParseError,
  jsonParseError,
  describeParseError,
  jsonFileErrorFields,
} from './parseError.js';

const SECRET = 'Hunter2Secret'; // pragma: allowlist secret

/** The error yaml.load throws for `text`. */
function yamlError(text) {
  try {
    yaml.load(text);
  } catch (err) {
    return err;
  }
  throw new Error(`parsed: ${text}`);
}

/** The error JSON.parse throws for `text`. */
function jsonError(text) {
  try {
    JSON.parse(text);
  } catch (err) {
    return err;
  }
  throw new Error(`parsed: ${text}`);
}

test('a YAML error is its reason and 1-based line and column, never the snippet or the file', () => {
  const text = [
    'integrations:',
    '  npm:',
    `    password: ${SECRET}-above`,
    `   token: ${SECRET}-on-the-line`,
    `    user: ${SECRET}-below`,
    '',
  ].join('\n');
  const err = yamlError(text);
  // What the logger would have written: the message holds the snippet.
  assert.ok(err.message.includes(SECRET), 'the premise: js-yaml quotes the file');

  const got = yamlParseError(err);
  assert.deepEqual(got, { reason: 'bad indentation of a mapping entry', line: 4, column: 4 });
  assert.ok(!JSON.stringify(got).includes(SECRET));
  assert.equal(describeParseError(got), 'bad indentation of a mapping entry at line 4, column 4');
});

test('a YAML reason that quotes the file loses the quoted text', async (t) => {
  // An unquoted value starting with * is an alias, one starting with ! a tag:
  // js-yaml names the alias or tag in its reason.
  const cases = {
    'an alias': [`password: *${SECRET}`, 'unidentified alias "…"'],
    'a local tag': [`password: !${SECRET}`, 'unknown tag !<…>'],
    'a core tag': [`password: !!${SECRET}`, 'unknown tag !<…>'],
    'a verbatim tag': [`password: !<${SECRET}> x`, 'unknown tag !<…>'],
    'a tag with a quote in it': [`password: !a%22${SECRET}%3E%22b x`, 'unknown tag !<…>'],
    'a tag handle': [`password: !${SECRET}!x y`, 'undeclared tag handle "…"'],
    'an alias with a quote in it': [`password: *a"${SECRET}"b`, 'unidentified alias "…"'],
    'a tag name with bad characters': [
      `password: !a%ZZ${SECRET} x`,
      'tag name cannot contain such characters: …',
    ],
    'a malformed tag name': [`password: !a%C0${SECRET} x`, 'tag name is malformed: …'],
    'a %TAG prefix': [`%TAG !e! tag:x,2000:%C0${SECRET}\n---\na: 1`, 'tag prefix is malformed: …'],
  };
  for (const [name, [text, reason]] of Object.entries(cases)) {
    await t.test(name, () => {
      const err = yamlError(text);
      const got = yamlParseError(err);
      assert.equal(got.reason, reason, err.reason);
      assert.ok(!JSON.stringify(got).includes(SECRET), JSON.stringify(got));
      assert.ok(Number.isInteger(got.line) && Number.isInteger(got.column));
    });
  }
});

test('a YAML reason with no text of the file is kept as it is', () => {
  const got = yamlParseError(yamlError('a: "unclosed\n'));
  assert.deepEqual(got, {
    reason: 'unexpected end of the stream within a double quoted scalar',
    line: 2,
    column: 1,
  });
});

test('anything else thrown while parsing YAML is "not valid YAML", with no position', () => {
  const plain = new Error(`boom ${SECRET}`);
  assert.deepEqual(yamlParseError(plain), { reason: 'not valid YAML', line: null, column: null });
  assert.deepEqual(yamlParseError(undefined), {
    reason: 'not valid YAML',
    line: null,
    column: null,
  });
  // A reason but a mark that is no position.
  assert.deepEqual(yamlParseError({ reason: 'x', mark: {} }), {
    reason: 'x',
    line: null,
    column: null,
  });
  assert.equal(describeParseError({ reason: 'x', line: null, column: null }), 'x');
  assert.equal(describeParseError({ reason: 'x', line: 3, column: null }), 'x at line 3');
});

test('a JSON error with an unexpected token never carries the text V8 quotes', () => {
  const err = jsonError(`{"token": ${SECRET}value}`);
  assert.ok(err.message.includes(SECRET.slice(0, 8)), 'the premise: V8 quotes the file');
  const got = jsonParseError(err);
  assert.deepEqual(got, { reason: 'Unexpected token', line: null, column: null });
  // The whole of a short file.
  assert.deepEqual(jsonParseError(jsonError(SECRET)), {
    reason: 'Unexpected token',
    line: null,
    column: null,
  });
});

test('a JSON error with a position keeps its words, line and column', () => {
  const got = jsonParseError(jsonError(`{\n  "token": "${SECRET}" "b": 1}`));
  assert.deepEqual(got, {
    reason: "Expected ',' or '}' after property value",
    line: 2,
    column: 28,
  });
  assert.deepEqual(jsonParseError(jsonError('')), {
    reason: 'Unexpected end of JSON input',
    line: null,
    column: null,
  });
});

test('a JSON error message not known to be free of the file is "not valid JSON"', () => {
  for (const message of [
    `"${SECRET}" is not valid JSON`,
    `Something new near "${SECRET}" in JSON at position 3 (line 1 column 4)`,
    `Unexpected ${SECRET}`,
  ]) {
    assert.deepEqual(jsonParseError(new SyntaxError(message)), {
      reason: 'not valid JSON',
      line: null,
      column: null,
    });
  }
  assert.equal(jsonParseError(new Error('x')).reason, 'not valid JSON');
});

test('jsonFileErrorFields logs a parse error as its reason and position, any other error as it is', () => {
  const parse = jsonError(`{"token": ${SECRET}}`);
  assert.deepEqual(jsonFileErrorFields(parse), {
    parseError: { reason: 'Unexpected token', line: null, column: null },
  });
  const read = Object.assign(new Error('EACCES: permission denied, open secrets.json'), {
    code: 'EACCES',
  });
  assert.deepEqual(jsonFileErrorFields(read), { err: read });
});
