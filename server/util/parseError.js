// @ts-check
/**
 * Why a file didn't parse, in words that never quote it (#504).
 *
 * A parser's own error quotes the file. js-yaml's message shows the lines
 * around the bad one (`mark.snippet`), and its `mark.buffer` is the whole
 * text; V8's JSON.parse error quotes the text near an unexpected token.
 * services.yaml can hold a plaintext credential (a legacy file, a hand edit),
 * and secrets.json, auth.json and display-config.json hold secrets too, so
 * logging that error put them in the log, and from there in Loki. The logger's
 * redaction (util/redact.js) knows URL credentials, not an arbitrary value.
 *
 * So no caller logs or answers a parse error itself, only what these return:
 * the reason and the position (1-based line and column, or null). A reason
 * that would quote the file loses the quoted text, and one not known to be
 * free of it is replaced whole.
 */

/** @typedef {{ reason: string, line: number | null, column: number | null }} ParseError */

/**
 * A js-yaml error as its reason and position. Anything else thrown while
 * parsing is 'not valid YAML', with no position.
 * @param {unknown} err
 * @returns {ParseError}
 */
export function yamlParseError(err) {
  const e = /** @type {any} */ (err);
  if (!e || typeof e.reason !== 'string' || !e.mark || typeof e.mark !== 'object') {
    return { reason: 'not valid YAML', line: null, column: null };
  }
  return {
    reason: scrubYamlReason(e.reason),
    line: oneBased(e.mark.line),
    column: oneBased(e.mark.column),
  };
}

/**
 * js-yaml's reason without the file's text. It quotes the file in three
 * forms: a tag as `!<tag>` (an unquoted value starting with `!` is one), an
 * alias (a value starting with `*`) or a tag handle in double quotes, and a
 * tag name or `%TAG` prefix after `: `. Each span runs to the last `>` or `"`
 * of the reason, so a `>` or `"` in the quoted text can't end it early.
 * @param {string} reason
 */
function scrubYamlReason(reason) {
  return reason
    .replace(/!<[\s\S]*>/, '!<…>')
    .replace(/"[\s\S]*"/, '"…"')
    .replace(/: [\s\S]*$/, ': …');
}

/** A 0-based js-yaml position as 1-based, or null. */
const oneBased = (/** @type {unknown} */ n) => (Number.isInteger(n) ? Number(n) + 1 : null);

// V8's messages that name a position: fixed words, then where.
const JSON_AT = /^(.+?) in JSON at position \d+(?: \(line (\d+) column (\d+)\))?$/;

/**
 * A JSON.parse error as its reason and position. V8 quotes the text around an
 * unexpected token (`Unexpected token 'h', ..."token": hunter2..." is not
 * valid JSON`), and names no position then; its other messages are fixed words
 * and a position. A message not known to be free of the file's text is
 * 'not valid JSON'.
 * @param {unknown} err
 * @returns {ParseError}
 */
export function jsonParseError(err) {
  const message = err instanceof SyntaxError ? err.message : '';
  const at = JSON_AT.exec(message);
  const line = at?.[2] ? Number(at[2]) : null;
  const column = at?.[3] ? Number(at[3]) : null;
  if (/^Unexpected token\b/.test(message)) return { reason: 'Unexpected token', line, column };
  if (at && !at[1].includes('"')) return { reason: at[1], line, column };
  if (message === 'Unexpected end of JSON input') return { reason: message, line, column };
  return { reason: 'not valid JSON', line: null, column: null };
}

/**
 * A parse error in words: "bad indentation of a mapping entry at line 5,
 * column 4", or the reason alone when it has no position.
 * @param {ParseError} parseError
 */
export function describeParseError({ reason, line, column }) {
  if (line === null) return reason;
  return column === null
    ? `${reason} at line ${line}`
    : `${reason} at line ${line}, column ${column}`;
}

/**
 * The fields to log for an error reading and parsing a JSON file: a parse
 * error as `{ parseError }` (jsonParseError); anything else, such as a file
 * that can't be read (its path and code, never its content), as `{ err }`.
 * @param {unknown} err
 */
export function jsonFileErrorFields(err) {
  return err instanceof SyntaxError ? { parseError: jsonParseError(err) } : { err };
}
