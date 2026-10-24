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
//   - window.confirm, globalThis.alert, window.top.prompt, however it is called
//     (`.call`, `.bind`, a reference passed on), window['confirm'], and any
//     computed key on the global object (name the property literally);
//   - a copy of the global object (`const w = window`) and what is read from
//     it, and `{ confirm } = window`;
//   - a bare confirm, alert or prompt, called or not (`const ask = confirm`),
//     that no binding in an enclosing scope declares. A `const confirm =
//     useConfirm()` is the app's own, but only inside the function (or block)
//     that declares it: it never excuses another component's bare call.
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

const WINDOWISH = new Set(['window', 'globalThis', 'self', 'top', 'parent', 'frames']);

/** `node` without parentheses, `as` casts, non-null marks and `<T>` assertions. */
function bare(node) {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    node = node.expression;
  return node;
}

/** The names a binding pattern or name declares. */
function namesOf(name, out = []) {
  if (ts.isIdentifier(name)) out.push(name.text);
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) namesOf(el.name, out);
  return out;
}

const isFunctionLike = (n) =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isConstructorDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) ||
  ts.isSetAccessorDeclaration(n);

/** What a statement list declares directly (let, const, var, function, class, import). */
function declaredBy(statements, out) {
  for (const st of statements) {
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations) namesOf(d.name, out);
    else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name)
      out.push(st.name.text);
    else if (ts.isImportDeclaration(st) && st.importClause) {
      const c = st.importClause;
      if (c.name) out.push(c.name.text);
      if (c.namedBindings) {
        if (ts.isNamespaceImport(c.namedBindings)) out.push(c.namedBindings.name.text);
        else for (const e of c.namedBindings.elements) out.push(e.name.text);
      }
    }
  }
}

/** `var`s anywhere in a function's body, not inside a nested function. */
function varsIn(node, out) {
  ts.forEachChild(node, (child) => {
    if (isFunctionLike(child)) return;
    if (
      ts.isVariableDeclarationList(child) &&
      !(child.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))
    )
      for (const d of child.declarations) namesOf(d.name, out);
    varsIn(child, out);
  });
}

/** The names `scope` declares for the code inside it, or null when it is not a scope. */
function scopeNames(scope) {
  const out = [];
  if (ts.isSourceFile(scope) || ts.isModuleBlock(scope)) declaredBy(scope.statements, out);
  else if (ts.isBlock(scope)) declaredBy(scope.statements, out);
  else if (ts.isCaseBlock(scope)) for (const c of scope.clauses) declaredBy(c.statements, out);
  else if (isFunctionLike(scope)) {
    for (const p of scope.parameters) namesOf(p.name, out);
    if (
      !ts.isFunctionDeclaration(scope) &&
      scope.name &&
      ts.isIdentifier(scope.name) &&
      !ts.isMethodDeclaration(scope)
    )
      out.push(scope.name.text);
    varsIn(scope, out);
  } else if (ts.isClassExpression(scope) && scope.name) out.push(scope.name.text);
  else if (ts.isCatchClause(scope) && scope.variableDeclaration)
    namesOf(scope.variableDeclaration.name, out);
  else if (
    (ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope)) &&
    scope.initializer &&
    ts.isVariableDeclarationList(scope.initializer)
  )
    for (const d of scope.initializer.declarations) namesOf(d.name, out);
  else return null;
  return new Set(out);
}

/** True for an identifier that names something in a place that is not a reference. */
function isNotReference(id) {
  const p = id.parent;
  return (
    (ts.isPropertyAccessExpression(p) && p.name === id) ||
    (ts.isQualifiedName(p) && p.right === id) ||
    ((ts.isPropertyAssignment(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isPropertySignature(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isMethodSignature(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) ||
      ts.isEnumMember(p)) &&
      p.name === id) ||
    (ts.isBindingElement(p) && (p.name === id || p.propertyName === id)) ||
    ((ts.isVariableDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isClassDeclaration(p) ||
      ts.isClassExpression(p) ||
      ts.isImportClause(p) ||
      ts.isNamespaceImport(p) ||
      ts.isImportSpecifier(p) ||
      ts.isExportSpecifier(p) ||
      ts.isLabeledStatement(p) ||
      ts.isBreakOrContinueStatement(p) ||
      ts.isTypeReferenceNode(p) ||
      ts.isInterfaceDeclaration(p) ||
      ts.isTypeAliasDeclaration(p)) &&
      (p.name === id || p.label === id || ts.isTypeReferenceNode(p) || ts.isExportSpecifier(p))) ||
    ts.isJsxOpeningElement(p) ||
    ts.isJsxClosingElement(p) ||
    ts.isJsxSelfClosingElement(p) ||
    ts.isJsxAttribute(p)
  );
}

/**
 * The browser dialogs `code` reaches, each as a short description with its
 * line. A bare `confirm`, `alert` or `prompt` is the browser's unless a
 * binding in an enclosing scope declares it (a `const confirm = useConfirm()`
 * in one component never excuses another's). The global object is `window`,
 * `globalThis`, `self`, `top`, `parent`, `frames`, `.window`/`.top`/… of any
 * of them, and any variable one is assigned to (`const w = window`).
 */
export function dialogsIn(code, name = 'file.jsx') {
  const source = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const where = (node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const cache = new Map();
  const names = (scope) => {
    if (!cache.has(scope)) cache.set(scope, scopeNames(scope));
    return cache.get(scope);
  };
  /** Whether a binding of `id.text` is declared in a scope around `id`. */
  const bound = (id) => {
    for (let n = id.parent; n; n = n.parent) {
      const set = names(n);
      if (set?.has(id.text)) return true;
      // A function expression's or class's own name; a parameter list reads its own.
    }
    return false;
  };

  const aliases = new Set();
  const isGlobal = (expr) => {
    const e = bare(expr);
    if (ts.isIdentifier(e)) return aliases.has(e.text) || (WINDOWISH.has(e.text) && !bound(e));
    if (ts.isPropertyAccessExpression(e))
      return (
        (WINDOWISH.has(e.name.text) && isGlobal(e.expression)) ||
        (e.name.text === 'defaultView' &&
          ts.isIdentifier(bare(e.expression)) &&
          bare(e.expression).text === 'document')
      );
    if (ts.isElementAccessExpression(e))
      return (
        ts.isStringLiteralLike(e.argumentExpression) &&
        WINDOWISH.has(e.argumentExpression.text) &&
        isGlobal(e.expression)
      );
    return false;
  };

  // Variables the global object is assigned to, until no more are found.
  const decls = [];
  const collect = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) decls.push(n);
    ts.forEachChild(n, collect);
  };
  collect(source);
  for (let grew = true; grew; ) {
    grew = false;
    for (const d of decls)
      if (!aliases.has(d.name.text) && isGlobal(d.initializer)) {
        aliases.add(d.name.text);
        grew = true;
      }
  }

  const found = [];
  const add = (node, what) => found.push(`${what} (line ${where(node)})`);
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && isGlobal(node.expression)) {
      if (DIALOGS.has(node.name.text)) add(node, node.getText());
    } else if (ts.isElementAccessExpression(node) && isGlobal(node.expression)) {
      const arg = node.argumentExpression;
      if (!ts.isStringLiteralLike(arg) || DIALOGS.has(arg.text))
        add(node, `${node.getText()}: name the property literally`);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      isGlobal(node.initializer)
    ) {
      for (const el of node.name.elements) {
        const key = el.propertyName ?? el.name;
        if (ts.isIdentifier(key) && DIALOGS.has(key.text))
          add(node, `{ ${key.text} } taken from the global object`);
      }
    } else if (ts.isIdentifier(node) && DIALOGS.has(node.text) && !isNotReference(node)) {
      if (!bound(node)) add(node, `${node.text} with no binding`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test('the scan finds each way the browser dialogs are reached (it can fail)', () => {
  const bad = {
    window: 'if (window.confirm("Sure?")) go();',
    alert: 'window.alert("done");',
    globalThis: 'globalThis.confirm("x");',
    self: 'self.prompt("name");',
    'window.top': 'window.top.confirm("x");',
    'window.parent': 'window.parent.alert("x");',
    'window.window': 'window.window.confirm("x");',
    'a cast': '(window as any).confirm("x");',
    'optional call': 'window.confirm?.("x");',
    'a literal key': 'window["confirm"]("x");',
    'a built key': 'window["con" + "firm"]("x");',
    'a computed key': 'const k = "confirm"; window[k]("x");',
    call: 'window.confirm.call(window, "x");',
    'a copy of the method': 'const ask = window.confirm; ask("x");',
    'a copy of the window': 'const w = window; w.confirm("x");',
    'a copy of a copy': 'const w = window; const v = w.top; v.alert("x");',
    'a destructure': 'const { confirm } = window; confirm("x");',
    'a renamed destructure': 'const { alert: say } = globalThis; say("x");',
    'a destructure of an alias': 'const w = self; const { prompt: p } = w;',
    'a bare call': 'if (confirm("Sure?")) go();',
    'a bare alert': 'alert("done");',
    'a bare prompt': 'function f() { return prompt("x"); }',
    'a copy of the bare name': 'const ask = confirm; ask("x");',
    'passed on': 'run(confirm);',
    typeof: 'if (typeof confirm === "function") go();',
    // The own `confirm` of one function does not excuse another's.
    'another component': `
      function A() { const confirm = useConfirm(); return () => confirm({}); }
      function B() { return () => confirm("x"); }`,
    'a block’s own': 'if (a) { const confirm = useConfirm(); } confirm("x");',
    'a callback’s own': 'items.map((confirm) => confirm); confirm("x");',
    'a function’s var': 'function f() { var alert = 1; } alert("x");',
  };
  for (const [what, code] of Object.entries(bad))
    assert.ok(dialogsIn(code).length > 0, `not found (${what}): ${code}`);
});

test('the scan leaves the app’s own confirm, comments and strings alone', () => {
  const fine = [
    'const confirm = useConfirm();\nawait confirm({ title: "Remove?" });',
    'function C() { const confirm = useConfirm(); return async () => { if (await confirm({ name })) go(); }; }',
    'function Row({ confirm }) { return confirm({ name }); }',
    'const Row = ({ confirm: ask, alert }) => { alert("x"); return ask({}); };',
    'items.forEach((confirm) => confirm());',
    'function f(prompt) { return prompt("x"); }',
    'import { confirm } from "./ui.js";\nconfirm({});',
    'import confirm from "./ui.js";\nawait confirm({});',
    'const confirm = vi.fn(); confirm("x"); expect(confirm).toHaveBeenCalled();',
    'const o = { confirm: 1, alert() {} }; o.confirm; o.alert();',
    'const { confirm } = useOverlay(); await confirm({});',
    'try { x(); } catch (alert) { alert.message; }',
    'for (const prompt of list) prompt();',
    'export function Confirm() { return <Dialog confirm="x" alert />; }',
    'class A { confirm() {} go() { this.confirm(); } }',
    '// never window.confirm("x") or alert("y")\nconst a = 1;',
    'const text = "window.confirm and alert(1)";',
    'const href = "javascript:alert(1)";',
    'const { confirmed } = window;',
    'window.matchMedia("(min-width: 1px)");',
    'const w = window; w.addEventListener("resize", f); w.top.location;',
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
