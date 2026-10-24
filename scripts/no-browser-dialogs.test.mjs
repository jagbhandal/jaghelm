// No browser dialogs (#323, UX audit m6): a destructive action asks with the
// Confirm dialog (src/ui/confirm.jsx), by the display name of what it acts on,
// and nothing in the app uses the browser's own `confirm()`, `alert()` or
// `prompt()`: they can't be styled, name nothing, block the page, and are
// suppressed by some embedded WebViews.
//
// Every file under src/ and mobile/src/ is read with TypeScript's parser,
// tests too (a test that stubs `window.confirm` is a sign the code under it
// still calls it), so a mention in a comment or a string is left alone. What
// is found:
//   - window.confirm, globalThis.alert, self.prompt, however it is called
//     (`.call`, `.bind`, a reference passed on), and window['confirm'];
//   - { confirm } = window, and the same from globalThis or self;
//   - a bare confirm(…), alert(…) or prompt(…) no binding in the file declares.
//     A local named `confirm` (`const confirm = useConfirm()`) is the app's
//     own and is fine; the bare call is the browser's only when nothing
//     declares it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['src', 'mobile/src'];
const SOURCE = /\.(jsx?|mjs|cjs|tsx?)$/;
const DIALOGS = new Set(['confirm', 'alert', 'prompt']);
const GLOBALS = new Set(['window', 'globalThis', 'self']);

function walk(dir) {
  const out = [];
  if (!existsSync(path.join(ROOT, dir))) return out;
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') out.push(...walk(rel));
    } else if (SOURCE.test(e.name)) out.push(rel);
  }
  return out;
}

/** The browser dialogs `code` uses, each as a short description with its line. */
export function dialogsIn(code, name = 'file.jsx') {
  const source = ts.createSourceFile(
    name,
    code,
    ts.ScriptTarget.Latest,
    true,
    /\.[jt]sx$/.test(name) || /\.js$/.test(name) ? ts.ScriptKind.TSX : undefined
  );
  const where = (node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const isGlobal = (node) => ts.isIdentifier(node) && GLOBALS.has(node.text);
  const found = [];
  const declared = new Set();
  const bareCalls = [];

  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && isGlobal(node.expression)) {
      if (DIALOGS.has(node.name.text)) found.push(`${node.getText()} (line ${where(node)})`);
    } else if (ts.isElementAccessExpression(node) && isGlobal(node.expression)) {
      const arg = node.argumentExpression;
      if (ts.isStringLiteralLike(arg) && DIALOGS.has(arg.text))
        found.push(`${node.getText()} (line ${where(node)})`);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      isGlobal(node.initializer)
    ) {
      for (const el of node.name.elements) {
        const key = el.propertyName ?? el.name;
        if (ts.isIdentifier(key) && DIALOGS.has(key.text))
          found.push(`{ ${key.text} } = ${node.initializer.text} (line ${where(node)})`);
      }
    }
    // Bindings that make a bare name the file's own.
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isImportSpecifier(node) ||
        ts.isImportClause(node) ||
        ts.isNamespaceImport(node) ||
        ts.isClassDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    )
      declared.add(node.name.text);
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      DIALOGS.has(node.expression.text)
    )
      bareCalls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);

  for (const call of bareCalls) {
    if (!declared.has(call.expression.text))
      found.push(`${call.expression.text}(…) with no binding (line ${where(call)})`);
  }
  return found;
}

test('the scan finds each way the browser dialogs are reached (it can fail)', () => {
  const bad = [
    'if (window.confirm("Sure?")) go();',
    'window.alert("done");',
    'globalThis.confirm("x");',
    'self.prompt("name");',
    'window["confirm"]("x");',
    'window.confirm.call(window, "x");',
    'const ask = window.confirm; ask("x");',
    'const { confirm } = window; confirm("x");',
    'const { alert: say } = globalThis; say("x");',
    'if (confirm("Sure?")) go();',
    'alert("done");',
    'function f() { return prompt("x"); }',
  ];
  for (const code of bad) assert.ok(dialogsIn(code).length > 0, `not found: ${code}`);
});

test('the scan leaves the app’s own confirm, comments and strings alone', () => {
  const fine = [
    'const confirm = useConfirm();\nawait confirm({ title: "Remove?" });',
    'function Row({ confirm }) { return confirm({ name }); }',
    'import { confirm } from "./ui.js";\nconfirm({});',
    '// never window.confirm("x") or alert("y")\nconst a = 1;',
    'const text = "window.confirm and alert(1)";',
    'const href = "javascript:alert(1)";',
    'const { confirmed } = window;',
    'window.matchMedia("(min-width: 1px)");',
    'expect(onAlert).toHaveBeenCalled(); fireAlert();',
  ];
  for (const code of fine) assert.deepEqual(dialogsIn(code), [], code);
});

test('no file in src/ uses the browser’s confirm, alert or prompt (#323)', () => {
  const files = DIRS.flatMap(walk);
  assert.ok(files.length > 200, `expected the app’s sources, found ${files.length} files`);
  const used = [];
  for (const file of files) {
    for (const hit of dialogsIn(readFileSync(path.join(ROOT, file), 'utf8'), file))
      used.push(`${file}: ${hit}`);
  }
  assert.deepEqual(
    used,
    [],
    'ask with the Confirm dialog (src/ui/confirm.jsx) and tell with a Toast or Banner'
  );
});
