// Version-aware source identity, not a list of allowed hashes or a sampled-price
// identity. For a legacy asset, partially evaluate ONLY the audited v2 dispatch
// boundaries. All remaining bytes keep the original release fingerprint format.
// Unknown syntax/dispatch shapes fail closed and require a fresh source review.
const ts = require('typescript');

function fail(message) { throw new Error('Unverified legacy/v2 boundary: ' + message); }
function parse(name, text) {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length) fail(name + ' has syntax errors');
  return file;
}
function compact(node, file) { return node.getText(file).replace(/\s+/g, ''); }
function exactly(text, from, to, count = 1) {
  if (text.split(from).length - 1 !== count) fail('unexpected shape: ' + from.slice(0, 90));
  return text.split(from).join(to);
}
function removeLines(text, node, file, followingBlank = false) {
  const start = text.lastIndexOf('\n', node.getStart(file) - 1) + 1;
  if (!/^[ \t]*$/.test(text.slice(start, node.getStart(file)))) fail('code before excluded statement');
  const end = node.end + (followingBlank ? 2 : 1);
  if (text.slice(node.end, end) !== (followingBlank ? '\n\n' : '\n')) fail('statement boundary');
  return text.slice(0, start) + text.slice(end);
}
function namedFunction(file, name) {
  const matches = file.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (matches.length !== 1 || !matches[0].body) fail('function ' + name);
  return matches[0];
}
function rejectHoisting(node) {
  // Even a never-entered branch can change legacy name resolution via `var`.
  // Do not elide declarations whose scope/transpilation escapes that block.
  if ((ts.isVariableDeclarationList(node) && !(node.flags & ts.NodeFlags.BlockScoped))
      || ts.isFunctionDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) {
    fail('hoisted declaration inside excluded branch');
  }
  ts.forEachChild(node, rejectHoisting);
}
function removeV2Branch(text, functionName, position) {
  const file = parse('simulationSchedule.ts', text);
  const node = namedFunction(file, functionName).body.statements[position];
  if (!node || !ts.isIfStatement(node) || node.elseStatement || !ts.isBlock(node.thenStatement)
      || compact(node.expression, file) !== "c.mode==='scenario-controls-v2'") fail(functionName + ' dispatch');
  rejectHoisting(node.thenStatement);
  // The dispatch envelope is reviewed code, not arbitrary dead code. A v2
  // request in the same process must not gain a new global side effect here.
  // Algorithm edits belong in the existing separate v2 module; changing these
  // boundaries requires review rather than silently expanding the exclusion.
  const envelope = functionName === 'validateScheduledScenario'
    ? "{if(c.version!==2||c.from!==listingAt||!Number.isSafeInteger(listingAt)||listingAt%TICK!==0)thrownewRangeError('Неверноевремяначаласценария');validateScenarioControls(c.controls,c.initialPrice);return;}"
    : '{validateScheduledScenario(c,listingAt);returncontrolledScenarioHour(c,seed,hour);}';
  if (compact(node.thenStatement, file) !== envelope) fail(functionName + ' v2 dispatch envelope');
  return removeLines(text, node, file);
}
function inertValue(node) {
  if (!node) return false;
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)
      || ts.isParenthesizedExpression(node)) return inertValue(node.expression);
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)
      || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return true;
  // Creating a function does not execute its body or its default parameters.
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true;
  if (ts.isPrefixUnaryExpression(node)) {
    if (node.operator === ts.SyntaxKind.ExclamationToken) return inertValue(node.operand);
    // Numeric coercion of an object/array/function may execute valueOf/toString.
    // Accept only literal numbers (unary plus on bigint would throw at import).
    return [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(node.operator) && ts.isNumericLiteral(node.operand);
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(inertValue);
  if (ts.isObjectLiteralExpression(node)) return node.properties.every(p => ts.isPropertyAssignment(p)
    && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name)) && inertValue(p.initializer));
  return false;
}
function verifyInertModule(name, source, allowRandomImport) {
  const file = parse(name, source);
  for (const node of file.statements) {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isFunctionDeclaration(node)) continue;
    if (ts.isImportDeclaration(node)) {
      if (node.importClause?.isTypeOnly) continue;
      const bindings = node.importClause?.namedBindings;
      if (allowRandomImport && node.moduleSpecifier.text === './simulationRandom' && !node.importClause.name
          && bindings && ts.isNamedImports(bindings) && bindings.elements.length === 1
          && bindings.elements[0].name.text === 'seededRandom' && !bindings.elements[0].propertyName) continue;
      fail(name + ' has an unverified runtime import');
    }
    if (ts.isVariableStatement(node) && (node.declarationList.flags & ts.NodeFlags.Const)
        && node.declarationList.declarations.every(d => ts.isIdentifier(d.name) && inertValue(d.initializer))) continue;
    fail(name + ' has a potentially effectful module initializer');
  }
}
function projectSchedule(text) {
  text = removeV2Branch(text, 'validateScheduledScenario', 0);
  text = removeV2Branch(text, 'scheduledScenarioHour', 1);
  text = exactly(text, "import { controlledScenarioHour, type ControlledScenarioConfig } from './simulationScenarioControls';\n", '');
  text = exactly(text, "import { validateScenarioControls } from '../../shared/listingScenarioControls';\n", '');
  text = exactly(text,
    'type LegacyScheduledScenarioConfig = GrowthScheduledScenarioConfig | RangeSelloffRangeScenarioConfig | CappedGrowthScenarioConfig;\nexport type ScheduledScenarioConfig = LegacyScheduledScenarioConfig | ControlledScenarioConfig;',
    'export type ScheduledScenarioConfig = GrowthScheduledScenarioConfig | RangeSelloffRangeScenarioConfig | CappedGrowthScenarioConfig;');
  text = exactly(text, 'c: LegacyScheduledScenarioConfig', 'c: ScheduledScenarioConfig', 2);
  // No erased import may remain reachable from the legacy implementation.
  const file = parse('legacy simulationSchedule.ts', text);
  function visit(node) {
    if (ts.isIdentifier(node) && ['controlledScenarioHour', 'ControlledScenarioConfig', 'validateScenarioControls', 'LegacyScheduledScenarioConfig'].includes(node.text)) fail('v2 binding reachable from legacy schedule');
    ts.forEachChild(node, visit);
  }
  visit(file);
  return text;
}
function projectSimulation(text) {
  const file = parse('testMarketSimulation.ts', text);
  const classes = file.statements.filter(n => ts.isClassDeclaration(n) && n.name?.text === 'TestMarketSimulation');
  if (classes.length !== 1) fail('simulation class');
  const members = classes[0].members.filter(n => n.name?.getText(file) === 'formatPrice');
  const property = members[0];
  if (members.length !== 1 || !ts.isPropertyDeclaration(property)
      || property.modifiers?.length !== 1 || property.modifiers[0].kind !== ts.SyntaxKind.PrivateKeyword
      || !property.initializer || !ts.isArrowFunction(property.initializer)) fail('formatter member');
  const arrow = property.initializer;
  if (arrow.modifiers?.length || arrow.parameters.length !== 1 || arrow.parameters[0].name.getText(file) !== 'price'
      || arrow.parameters[0].initializer || arrow.parameters[0].dotDotDotToken
      || !ts.isBlock(arrow.body) || arrow.body.statements.length !== 2) fail('formatter body');
  const [declaration, returned] = arrow.body.statements;
  if (!ts.isVariableStatement(declaration) || compact(declaration, file) !== 'constprogram=this.asset.scheduledScenario;'
      || !ts.isReturnStatement(returned) || !returned.expression || !ts.isConditionalExpression(returned.expression)) fail('formatter dispatch');
  if (compact(returned.expression.condition, file) !== "!this.asset.isTradable&&program?.mode==='scenario-controls-v2'"
      || compact(returned.expression.whenFalse, file) !== 'round(price)') fail('formatter legacy fallback');
  if (compact(returned.expression.whenTrue, file) !== 'Math.min(Number(program.controls.maxPrice),Number(price.toFixed(10)))') fail('formatter v2 envelope');
  text = removeLines(text, property, file, true);
  text = exactly(text, 'function candleFromTicks(openTime: number, open: number, ticks: Tick[], format = round): SimCandle {',
    'function candleFromTicks(openTime: number, open: number, ticks: Tick[]): SimCandle {');
  for (const expression of ['open', 'Math.max(high, open, close)', 'Math.min(low, open, close)', 'close']) {
    text = exactly(text, 'format(' + expression + ')', 'round(' + expression + ')');
  }
  for (const asset of ['this.asset', 'asset']) {
    text = exactly(text, `(!${asset}.isTradable && (${asset}.scheduledScenario?.mode === 'capped-growth-range' || ${asset}.scheduledScenario?.mode === 'scenario-controls-v2'))`,
      `(!${asset}.isTradable && ${asset}.scheduledScenario?.mode === 'capped-growth-range')`);
  }
  text = exactly(text, 'String(this.formatPrice(tick.price))', 'String(round(tick.price))');
  text = exactly(text, 'ticks.slice(0, done), this.formatPrice)', 'ticks.slice(0, done))');
  text = exactly(text, 'ticks.slice(first, first + done), this.formatPrice)', 'ticks.slice(first, first + done))');
  const projected = parse('legacy testMarketSimulation.ts', text);
  function visit(node) {
    if (ts.isIdentifier(node) && node.text === 'formatPrice') fail('unverified formatter reference');
    ts.forEachChild(node, visit);
  }
  visit(projected);
  return text;
}
function projectLegacySources(sources, readSource) {
  const schedule = sources['simulationSchedule.ts'], simulation = sources['testMarketSimulation.ts'];
  if (!schedule.includes('scenario-controls-v2') && !simulation.includes('scenario-controls-v2')) return sources;
  verifyInertModule('simulationScenarioControls.ts', readSource('simulationScenarioControls.ts'), true);
  verifyInertModule('../../shared/listingScenarioControls.ts', readSource('../../shared/listingScenarioControls.ts'), false);
  return { ...sources, 'simulationSchedule.ts': projectSchedule(schedule), 'testMarketSimulation.ts': projectSimulation(simulation) };
}
module.exports = { projectLegacySources };
