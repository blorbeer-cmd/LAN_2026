import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';

export const cssFiles = ['style', 'domains', 'arcade', 'overlays', 'kiosk'].map(name => `server/public/css/${name}.css`);
const registryFile = 'server/frontend-contracts/component-registry.mjs';
const contractRoot = 'server/frontend-contracts/';
const controlTags = new Set(['button', 'input', 'select', 'textarea', 'summary']);
const geometry = /^(?:width|height|min-width|max-width|min-height|max-height)$/;
export const isProtected = property => /^(?:font-size|line-height|padding(?:-.+)?|(?:min-|max-)?(?:width|height|inline-size|block-size)|white-space|border(?:-.+)?-radius|outline(?:-.+)?|box-shadow|--icon-size)$/.test(property);
const lineAt = (source, offset) => source.slice(0, offset).split('\n').length;
function withoutComments(source) {
  const chars = source.split('');
  let quote = '', comment = false;
  for (let i = 0; i < chars.length; i++) {
    const c = source[i];
    if (comment) {
      if (c !== '\n' && c !== '\r') chars[i] = ' ';
      if (c === '*' && source[i + 1] === '/') { chars[++i] = ' '; comment = false; }
    } else if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '/' && source[i + 1] === '*') { chars[i] = chars[++i] = ' '; comment = true; }
  }
  return chars.join('');
}
const compare = (a, b) => {
  for (const key of ['file', 'line', 'property', 'value', 'selector', 'code', 'id']) {
    const x = a[key] ?? '', y = b[key] ?? '';
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
};

// Delimiters inside comments, strings, attributes and functions are never structural.
function delimiters(source, chars) {
  const result = [];
  let quote = '', comment = false, parentheses = 0, brackets = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (comment) { if (c === '*' && next === '/') { comment = false; i++; } continue; }
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '/' && next === '*') { comment = true; i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '\\') { i++; continue; }
    if (c === '(') parentheses++;
    else if (c === ')') parentheses--;
    else if (c === '[') brackets++;
    else if (c === ']') brackets--;
    else if (!parentheses && !brackets && chars.includes(c)) result.push(i);
  }
  if (quote || comment || parentheses || brackets) throw new Error('Unbalanced CSS string, comment or brackets');
  return result;
}

export function splitSelectors(selector) {
  const points = [-1, ...delimiters(selector, ','), selector.length];
  return points.slice(1).map((end, i) => withoutComments(selector.slice(points[i] + 1, end)).trim()).filter(Boolean);
}

function normalize(selector) {
  return withoutComments(selector).replace(/"([^"\n]*)"/g, "'$1'").replace(/\s*([>+~])\s*/g, '$1').replace(/\s+/g, ' ').trim();
}

export function subject(selector) {
  const positions = delimiters(selector, ' >+~\t\n\r');
  const last = positions.at(-1) ?? -1;
  return selector.slice(last + 1).trim();
}

function hasContext(selector) {
  if (subject(selector) !== selector || /:has\(/.test(selector)) return true;
  // A relational branch inside :is/:where is still a context selector.
  return /:(?:is|where)\([^)]*(?:[>+~]|[\w.)\]]\s+[.#\w*])/.test(selector);
}

function selectorClassNames(selector) {
  const names = [];
  let quote = '', brackets = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '\\') { i++; continue; }
    if (c === '[') brackets++;
    else if (c === ']') brackets--;
    else if (!brackets && c === '.') {
      const name = selector.slice(i + 1).match(/^[a-zA-Z_][\w-]*/)?.[0];
      if (name) { names.push(name); i += name.length; }
    }
  }
  return names;
}

function classes(selector) {
  // :not/:has arguments describe exclusions/relatives, not classes of the selected subject.
  let clean = selector;
  for (const name of ['not', 'has']) {
    let start;
    while ((start = clean.indexOf(`:${name}(`)) >= 0) {
      let depth = 1, end = start + name.length + 2;
      while (end < clean.length && depth) { if (clean[end] === '(') depth++; if (clean[end] === ')') depth--; end++; }
      clean = clean.slice(0, start) + clean.slice(end);
    }
  }
  return selectorClassNames(clean);
}

export function parseCss(source, file) {
  const rules = [], declarations = [];
  const masked = withoutComments(source), suppressionLines = new Set();
  for (const match of source.matchAll(/\/\*[^\n]*?\bdesign-token-ok\s*:\s*([^\n]*?)\*\//g)) {
    if (match[1].trim() && masked.slice(match.index, match.index + 2) === '  ') suppressionLines.add(lineAt(source, match.index));
  }
  const points = delimiters(source, '{};');
  const stack = [];
  let start = 0;
  const declaration = end => {
    const raw = source.slice(start, end), clean = withoutComments(raw);
    const colon = delimiters(clean, ':')[0];
    if (colon === undefined || !stack.length) return;
    const property = clean.slice(0, colon).trim().toLowerCase();
    if (!/^(?:--)?[a-z][\w-]*$/.test(property)) return;
    const offset = start + clean.search(/\S/);
    const line = lineAt(source, offset);
    const value = clean.slice(colon + 1).trim();
    const suppressed = suppressionLines.has(line);
    const item = { file, line, property, value, selectors: stack.at(-1).selectors, atRules: stack.at(-1).atRules, suppressed };
    declarations.push(item);
    stack.at(-1).declarations.push(item);
  };
  for (const end of points) {
    const c = source[end];
    if (c === '{') {
      const preamble = withoutComments(source.slice(start, end)).trim();
      const parent = stack.at(-1);
      const atRule = preamble.startsWith('@');
      const selectors = atRule ? (parent?.selectors ?? []) : splitSelectors(preamble);
      const rule = { file, line: lineAt(source, start + withoutComments(source.slice(start, end)).search(/\S/)), selectors, declarations: [], atRules: [...(parent?.atRules ?? []), ...(atRule ? [preamble] : [])] };
      stack.push(rule);
      if (!atRule || selectors.length) rules.push(rule);
    } else if (c === ';') declaration(end);
    else {
      declaration(end);
      if (!stack.length) throw new Error(`${file}: unexpected closing brace`);
      stack.pop();
    }
    start = end + 1;
  }
  if (stack.length) throw new Error(`${file}: unclosed CSS block`);
  return { rules, declarations };
}

const literal = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
const propertyName = node => ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined;

export function inventoryJs(source, file) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const markup = [], assignments = [], boundaries = [], emptyStates = [], literals = [], templates = [];
  const fragments = [];
  const location = node => lineAt(source, node.getStart(ast));
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      fragments.push({ text: node.text, offset: node.getStart(ast) + 1 });
      literals.push({ file, line: location(node), value: node.text });
    }
    else if (ts.isTemplateExpression(node)) {
      templates.push({ file, line: location(node), value: node.getText(ast) });
      // Mask expressions without joining partial dynamic class names into invented literals.
      const start = node.getStart(ast) + 1;
      let text = source.slice(start, node.end - 1).split('');
      for (const span of node.templateSpans) {
        const from = span.expression.pos - start - 2;
        const to = span.literal.getStart(ast) - start + 1;
        for (let i = Math.max(0, from); i < to; i++) if (text[i] !== '\n') text[i] = '§';
      }
      fragments.push({ text: text.join(''), offset: start });
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = node.left;
      if ((ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) && ts.isPropertyAccessExpression(left.expression) && left.expression.name.text === 'style') {
        const property = ts.isPropertyAccessExpression(left) ? left.name.text : literal(left.argumentExpression);
        const receiver = left.expression.expression.getText(ast);
        if (property === undefined) boundaries.push({ file, line: location(node), kind: 'dynamic-property', source: left.getText(ast) });
        else assignments.push({ file, line: location(node), callKey: `${receiver}.style.${property}`, receiver, property: property.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`), value: literal(node.right) ?? node.right.getText(ast) });
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'setProperty' && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === 'style') {
      const property = literal(node.arguments[0]), receiver = node.expression.expression.expression.getText(ast);
      if (property === undefined) boundaries.push({ file, line: location(node), kind: 'dynamic-property', source: node.expression.getText(ast) });
      else assignments.push({ file, line: location(node), callKey: `${receiver}.style.${property}`, receiver, property, value: literal(node.arguments[1]) ?? node.arguments[1]?.getText(ast) ?? '' });
    }
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'emptyStateHtml') {
      for (const arg of node.arguments) if (ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) if (ts.isPropertyAssignment(prop) && ['style', 'className'].includes(propertyName(prop.name))) {
          emptyStates.push({ file, line: location(prop), callKey: `emptyStateHtml.${propertyName(prop.name)}`, property: propertyName(prop.name), value: literal(prop.initializer) ?? prop.initializer.getText(ast), dynamic: literal(prop.initializer) === undefined });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const fragment of fragments) {
    for (const match of fragment.text.matchAll(/<\/?§+/g)) boundaries.push({ file, line: lineAt(source, fragment.offset + match.index), kind: 'dynamic-tag', source: match[0] });
    // Quotes may contain >, including template expressions; stop only at the actual tag end.
    for (const match of fragment.text.matchAll(/<([a-z][\w-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
      const tag = match[1].toLowerCase(), attrs = {};
      for (const attr of match[2].matchAll(/\b([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? '';
      const names = (attrs.class ?? '').split(/\s+/).filter(name => /^[a-zA-Z_][\w-]*$/.test(name));
      const line = lineAt(source, fragment.offset + match.index);
      if ((attrs.class ?? '').includes('§')) boundaries.push({ file, line, kind: 'dynamic-class', source: match[0], callSource: source.slice(fragment.offset + match.index, fragment.offset + match.index + match[0].length), control: controlTags.has(tag) || names.some(name => name === 'btn' || name === 'icon-btn') });
      if (controlTags.has(tag) || names.some(name => name === 'btn' || name === 'icon-btn')) markup.push({ file, line, tag, classes: names, id: attrs.id, style: attrs.style, selector: `${tag}${names.map(name => `.${name}`).join('')}`, attributes: attrs });
    }
  }
  return { markup, assignments, boundaries, emptyStates, literals, templates };
}

export function readSnapshot(cwd, mode) {
  if (!['staged', 'head'].includes(mode)) throw new Error('Use --staged or --head; working-tree input is not supported');
  let gitDirectory = cwd;
  const git = args => execFileSync('git', args, { cwd: gitDirectory, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const root = git(['rev-parse', '--show-toplevel']).trim();
  gitDirectory = root;
  const entries = mode === 'staged' ? git(['ls-files', '--stage', '-z']) : git(['ls-tree', '-r', '-z', 'HEAD']);
  const files = new Map(), blobs = [];
  for (const entry of entries.split('\0').filter(Boolean)) {
    const [metadata, file] = entry.split('\t');
    if (!(cssFiles.includes(file) || /^server\/public\/js\/.*\.js$/.test(file) || file === registryFile || /^server\/frontend-contracts\/components\/.*\.md$/.test(file))) continue;
    const parts = metadata.split(' ');
    if (mode === 'staged' && parts[2] !== '0') throw new Error(`Unmerged index entry: ${file}`);
    if (parts[0] !== '100644' && parts[0] !== '100755') throw new Error(`Expected regular snapshot file: ${file}`);
    blobs.push({ file, oid: parts[mode === 'staged' ? 1 : 2] });
  }
  const batch = execFileSync('git', ['cat-file', '--batch'], { cwd, input: blobs.map(item => item.oid).join('\n') + '\n', maxBuffer: 64 * 1024 * 1024 });
  let offset = 0;
  for (const blob of blobs) {
    const end = batch.indexOf(10, offset), header = batch.subarray(offset, end).toString('utf8').split(' ');
    if (header[0] !== blob.oid || header[1] !== 'blob') throw new Error(`Cannot read snapshot blob ${blob.file}`);
    const length = Number(header[2]);
    files.set(blob.file, batch.subarray(end + 1, end + 1 + length).toString('utf8'));
    offset = end + length + 2;
  }
  for (const required of [...cssFiles, registryFile]) if (!files.has(required)) throw new Error(`Missing ${mode} snapshot file: ${required}`);
  return { root, files };
}

export async function loadRegistry(source) {
  // Import the snapshot bytes, never the working-tree registry or its transitive files.
  const ast = ts.createSourceFile('registry.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const result = {};
  function data(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(data);
    if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(prop => {
      if (!ts.isPropertyAssignment(prop) || propertyName(prop.name) === undefined) throw new Error('Registry must contain only literal data');
      return [propertyName(prop.name), data(prop.initializer)];
    }));
    throw new Error('Registry must contain only literal data');
  }
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) throw new Error('Registry must export only literal data');
    for (const item of statement.declarationList.declarations) result[item.name.getText(ast)] = data(item.initializer);
  }
  return result;
}

export async function analyze(files) {
  const registry = await loadRegistry(files.get(registryFile));
  const diagnostics = [], findings = [], candidates = [], rules = [];
  const js = { markup: [], assignments: [], boundaries: [], emptyStates: [], literals: [], templates: [] };
  for (const file of cssFiles) {
    const parsed = parseCss(files.get(file), file);
    rules.push(...parsed.rules);
    for (const declaration of parsed.declarations) {
      if (declaration.property.startsWith('--') || declaration.suppressed) continue;
      const item = { ...declaration }; delete item.suppressed;
      const value = declaration.value;
      if (geometry.test(declaration.property) && /(?:^|[^\w-])[-+]?(?:\d*\.)?\d+px\b/i.test(value)) candidates.push({ ...item, kind: 'geometry' });
      if (/\brgba\(/i.test(value)) candidates.push({ ...item, kind: 'color' });
    }
  }
  for (const [file, source] of files) if (/^server\/public\/js\/.*\.js$/.test(file)) {
    const inventory = inventoryJs(source, file);
    for (const key of Object.keys(js)) js[key].push(...inventory[key]);
  }
  const components = registry.components ?? [], variants = registry.permanentVariants ?? [], exceptions = registry.temporaryExceptions ?? [];
  const entries = [...components, ...variants, ...exceptions], used = new Set(), usedCalls = new Set();
  const idSet = new Set();
  const contractFiles = [...files.keys()].filter(file => file.startsWith(`${contractRoot}components/`));
  const selectors = entry => splitSelectors(entry.selector ?? '');
  for (const entry of entries) {
    const required = exceptions.includes(entry) ? ['id', 'file', 'property', 'reason', 'finding', 'targetPackage', 'removalCriterion', 'contract'] : ['id', 'role', 'selector', 'owner', 'contract', variants.includes(entry) ? 'reason' : 'purpose'];
    if (required.some(key => entry[key] === undefined || entry[key] === '') || (!entry.selector && !entry.callKey)) diagnostics.push({ id: entry.id, code: 'invalid-entry' });
    if (idSet.has(entry.id)) diagnostics.push({ id: entry.id, code: 'duplicate-id' });
    idSet.add(entry.id);
    const [path, anchor] = (entry.contract ?? '').split('#');
    const contract = `${contractRoot}${path}`;
    const source = files.get(contract);
    const anchors = [...(source ?? '').matchAll(/^#+\s+(.+)$/gm)].map(match => match[1].toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-'));
    if (!source || !anchor || !anchors.includes(anchor)) diagnostics.push({ id: entry.id, code: 'missing-contract-anchor', file: contract });
    // Explicit ownership references distinguish shared API links from registry ownership.
    const references = contractFiles.filter(file => [...files.get(file).matchAll(/\bregistry:([\w-]+)/g)].some(match => match[1] === entry.id));
    if (references.length !== 1 || references[0] !== contract) diagnostics.push({ id: entry.id, code: 'contract-reference-count', value: String(references.length), file: contract });
    if (entry.owner && !files.has(`server/${entry.owner}`)) diagnostics.push({ id: entry.id, code: 'missing-owner', file: entry.owner });
  }
  const classEntries = new Map();
  for (const entry of [...components, ...variants]) for (const sel of selectors(entry)) for (const name of classes(subject(sel))) {
    if (!classEntries.has(name)) classEntries.set(name, []);
    classEntries.get(name).push(entry);
  }
  const knownJsClasses = new Set(js.markup.flatMap(item => item.classes));
  function applicable(sel) {
    const sub = subject(sel), names = classes(sub), tag = sub.match(/^([a-z][\w-]*)/i)?.[1];
    return names.some(name => classEntries.get(name)?.some(entry => components.includes(entry) && entry.control !== false) || knownJsClasses.has(name)) || ['button', 'input', 'select', 'textarea'].includes(tag) || /:(?:is|where)\([^)]*\b(?:button|input|select|textarea)\b/.test(sub) || (tag === 'summary' && names.includes('btn'));
  }
  function elementMatches(selector, element) {
    if (!element || hasContext(selector) || selector.includes(':')) return false;
    const tag = selector.match(/^[a-z][\w-]*/i)?.[0];
    if (tag && tag !== element.tag) return false;
    if (!classes(selector).every(name => element.classes.includes(name))) return false;
    const id = selector.match(/#([\w-]+)/)?.[1];
    if (id && id !== element.id) return false;
    for (const attr of selector.matchAll(/\[([\w-]+)(?:=['"]?([^'"\]]+)['"]?)?\]/g)) {
      if (!(attr[1] in element.attributes) || (attr[2] !== undefined && element.attributes[attr[1]] !== attr[2])) return false;
    }
    return true;
  }
  function exceptionFor(item, element) {
    return exceptions.find(entry => `server/${entry.file}` === item.file && entry.property === item.property && (entry.selector ? normalize(entry.selector) === normalize(item.selector ?? '') || elementMatches(entry.selector, element) : entry.callKey === item.callKey) && (entry.value === undefined || entry.value === item.value));
  }
  function record(item, owner, element) {
    if (/\.test\.js$/.test(item.file)) {
      findings.push({ ...item, classification: 'static-false-candidate', reason: 'Test fixture source is inventoried but is not an application caller.' });
      return;
    }
    const binding = entries.find(entry => entry.calls?.some(call => `server/${call.file}` === item.file && call.callKey === item.callKey && call.property === item.property && call.value === item.value));
    if (binding) {
      used.add(binding.id);
      for (const call of binding.calls) if (`server/${call.file}` === item.file && call.callKey === item.callKey && call.property === item.property && call.value === item.value) usedCalls.add(call);
      findings.push({ ...item, classification: binding.control === false ? 'static-false-candidate' : 'permanent-variant', registryId: binding.id, reason: binding.reason ?? binding.purpose });
      return;
    }
    const exception = exceptionFor(item, element);
    if (owner) { used.add(owner.id); findings.push({ ...item, classification: variants.includes(owner) ? 'permanent-variant' : 'component-owner', registryId: owner.id }); }
    else if (exception) { used.add(exception.id); findings.push({ ...item, classification: 'temporary-exception', registryId: exception.id }); }
    else findings.push({ ...item, classification: 'violation' });
  }
  for (const rule of rules) for (const sel of rule.selectors) {
    const normalized = normalize(sel), sub = subject(normalized);
    const exactVariants = variants.filter(entry => `server/${entry.owner}` === rule.file && selectors(entry).some(value => normalize(value) === normalized));
    for (const entry of exactVariants) used.add(entry.id);
    const owner = components.find(entry => `server/${entry.owner}` === rule.file && selectors(entry).some(value => {
      const base = normalize(value);
      const baseClasses = classes(base), ownClasses = classes(sub);
      const classMatch = baseClasses.length && baseClasses.every(name => ownClasses.includes(name)) && !base.includes(':') && !base.includes('[');
      return !hasContext(normalized) && !hasContext(base) && (base === normalized || classMatch || (normalized.startsWith(base) && /^[:.[]/.test(normalized.slice(base.length))));
    }));
    if (owner) used.add(owner.id);
    for (const name of selectorClassNames(sel).filter(name => /^(?:btn|icon-btn)-/.test(name))) {
      record({ file: rule.file, line: rule.line, selector: sel, property: 'class', value: name, code: 'modifier' }, classEntries.get(name)?.[0]);
    }
    const internalIcon = /(?:\.ui-icon|\bsvg)(?=[:.#[]|$)/.test(sub) && applicable(normalized.slice(0, normalized.length - sub.length).replace(/[ >+~]+$/, ''));
    if (!applicable(sel) && !internalIcon) continue;
    for (const declaration of rule.declarations) if (isProtected(declaration.property)) {
      record({ file: rule.file, line: declaration.line, selector: sel, property: declaration.property, value: declaration.value, code: internalIcon ? 'internal-icon' : 'css-ownership' }, exactVariants.find(entry => !entry.properties || entry.properties.includes(declaration.property)) ?? owner);
    }
  }
  for (const item of js.markup) {
    const fixture = /\.test\.js$/.test(item.file);
    for (const name of item.classes) {
      const row = { file: item.file, line: item.line, selector: item.selector, property: 'class', value: name, code: /^(?:btn|icon-btn)-/.test(name) ? 'modifier' : 'markup-class' };
      if (fixture) findings.push({ ...row, classification: 'static-false-candidate', reason: 'Test fixture markup is inventoried but is not an application caller.' });
      else record(row, classEntries.get(name)?.[0], item);
    }
    if (item.style) {
      for (const declaration of parseCss(`x {${item.style}}`, item.file).declarations) if (isProtected(declaration.property)) record({ file: item.file, line: item.line, selector: item.selector, property: declaration.property, value: declaration.value, code: 'inline-style' }, undefined, item);
    }
  }
  for (const item of js.assignments) if (isProtected(item.property)) record({ ...item, code: 'element-style' });
  for (const item of js.emptyStates) {
    if (item.property === 'className' && !item.dynamic) {
      for (const name of item.value.split(/\s+/).filter(Boolean)) record({ ...item, value: name, code: 'empty-state-presentation' }, classEntries.get(name)?.[0]);
    } else if (item.property === 'style' && !item.dynamic && parseCss(`x {${item.value}}`, item.file).declarations.every(decl => !isProtected(decl.property))) {
      findings.push({ ...item, code: 'empty-state-presentation', classification: 'component-owner', registryId: 'empty-state', reason: 'Caller-owned outer placement; no protected interior property.' });
    } else record({ ...item, code: 'empty-state-presentation' });
  }
  for (const item of js.literals) for (const match of item.value.matchAll(/(?:^|[\s.])(btn-[\w-]+|icon-btn-[\w-]+)(?=$|[\s.:#[\]])/g)) record({ ...item, value: match[1], property: 'class', code: 'literal-modifier' }, classEntries.get(match[1])?.[0]);
  for (const item of js.boundaries) if (item.control && !/\.test\.js$/.test(item.file)) {
    const binding = [...components, ...variants].find(entry => entry.dynamicUses?.some(use => `server/${use.file}` === item.file && item.callSource.includes(use.source) && use.reason));
    if (binding) used.add(binding.id);
    else diagnostics.push({ file: item.file, line: item.line, code: 'unregistered-dynamic-control', value: item.callSource });
  }
  // A marker can be used in a literal conditional without creating its own declaration.
  for (const entry of [...components, ...variants]) {
    for (const use of entry.dynamicUses ?? []) {
      if (js.templates.some(item => item.file === `server/${use.file}` && item.value.includes(use.source)) && use.reason) used.add(entry.id);
      else diagnostics.push({ id: entry.id, file: use.file, code: 'stale-dynamic-use' });
    }
    for (const call of entry.calls ?? []) if (!usedCalls.has(call)) diagnostics.push({ id: entry.id, file: call.file, code: 'stale-call-binding', value: call.callKey });
    if (selectors(entry).some(sel => rules.some(rule => rule.file === `server/${entry.owner}` && rule.selectors.some(value => normalize(value) === normalize(sel))))) used.add(entry.id);
    if (components.includes(entry) && selectors(entry).some(sel => /^\.[\w-]+$/.test(sel) && js.literals.some(item => !/\.test\.js$/.test(item.file) && item.value.split(/\s+/).includes(sel.slice(1))))) used.add(entry.id);
  }
  for (const entry of entries) if (!used.has(entry.id)) diagnostics.push({ id: entry.id, code: 'stale-entry' });
  for (const file of contractFiles) for (const match of files.get(file).matchAll(/\bregistry:([\w-]+)/g)) if (!idSet.has(match[1])) diagnostics.push({ file, id: match[1], code: 'unknown-reference' });
  for (const list of [candidates, findings, diagnostics, ...Object.values(js)]) list.sort(compare);
  const violations = findings.filter(item => item.classification === 'violation');
  const { markup, assignments, boundaries, emptyStates } = js;
  const digest = createHash('sha256');
  for (const [file, source] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) digest.update(file + '\0' + source + '\0');
  return { snapshotDigest: digest.digest('hex'), counts: { geometryCandidates: candidates.filter(item => item.kind === 'geometry').length, colorCandidates: candidates.filter(item => item.kind === 'color').length, violations: violations.length, registryDiagnostics: diagnostics.length }, candidates, findings, violations, registryDiagnostics: diagnostics, js: { markup, assignments, boundaries, emptyStates }, exitCode: violations.length || diagnostics.length ? 1 : 0 };
}

export async function run(cwd, mode) {
  return analyze(readSnapshot(cwd, mode).files);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => !['--staged', '--head', '--json'].includes(arg)) || (args.includes('--head') && args.includes('--staged'))) throw new Error('Usage: check-component-contracts.mjs [--staged | --head] [--json]');
    const mode = args.includes('--head') ? 'head' : 'staged';
    const result = await run(process.cwd(), mode);
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Component contracts (${mode})`);
      for (const candidate of result.candidates) console.log(`CANDIDATE ${candidate.kind} ${candidate.file}:${candidate.line} ${candidate.property}: ${candidate.value}`);
      for (const finding of result.findings) console.log(`${finding.classification.toUpperCase()} ${finding.file}:${finding.line} ${finding.selector ?? finding.callKey} ${finding.property}: ${finding.value} ${finding.registryId ?? ''}`);
      for (const diagnostic of result.registryDiagnostics) console.log(`REGISTRY ${diagnostic.code} ${diagnostic.id} ${diagnostic.file ?? ''}`);
      console.log(JSON.stringify(result.counts));
    }
    process.exitCode = result.exitCode;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
