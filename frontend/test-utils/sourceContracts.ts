import ts from 'typescript';

const parse = (source: string) => ts.createSourceFile('contract.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Read declarations by syntax, independent of JSX attribute order or indentation. */
export function variableInitializer(source: string, name: string): string {
  const file = parse(source);
  const matches: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) matches.push(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (matches.length !== 1) throw new Error(`Expected one initialized declaration: ${name}`);
  return matches[0].getText(file);
}

export function functionDeclaration(source: string, name: string): string {
  const file = parse(source);
  const matches: ts.FunctionDeclaration[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (matches.length !== 1) throw new Error(`Expected one function declaration: ${name}`);
  return matches[0].getText(file);
}

/** Both expression-bodied and block-bodied React.lazy loaders stay lazy. */
export function lazyPageImports(source: string, page: string): string[] {
  const initializer = parse(`const candidate = ${variableInitializer(source, page)};`);
  const declaration = (initializer.statements[0] as ts.VariableStatement).declarationList.declarations[0];
  const call = declaration.initializer;
  if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== 'lazy') return [];
  const imports: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  call.arguments.forEach(visit);
  return imports;
}

export function routeElement(source: string, path: string): string {
  const file = parse(source);
  const matches: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(file) === 'Route') {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
      const routePath = attributes.find((attribute) => attribute.name.getText(file) === 'path')?.initializer;
      if (routePath && ts.isStringLiteral(routePath) && routePath.text === path) {
        const element = attributes.find((attribute) => attribute.name.getText(file) === 'element')?.initializer;
        if (element && ts.isJsxExpression(element) && element.expression) matches.push(element.expression.getText(file));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (matches.length !== 1) throw new Error(`Expected one route element: ${path}`);
  return matches[0];
}

/** Class strings only: a ternary condition such as isSelected is not a CSS class. */
export function jsxClassNames(source: string): Set<string> {
  const file = parse(source);
  const classes = new Set<string>();
  const add = (value: string) => value.split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
  const values = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node)) add(node.text);
    else if (ts.isTemplateExpression(node)) {
      add(node.head.text);
      for (const span of node.templateSpans) { values(span.expression); add(span.literal.text); }
    } else if (ts.isConditionalExpression(node)) { values(node.whenTrue); values(node.whenFalse); }
    else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) values(node.expression);
    else if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) values(node.right);
      else if ([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
        values(node.left); values(node.right);
      }
    } else if (ts.isArrayLiteralExpression(node)) node.elements.forEach(values);
    else if (ts.isCallExpression(node)) node.arguments.forEach(values);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(file) === 'className' && node.initializer) {
      if (ts.isStringLiteral(node.initializer)) add(node.initializer.text);
      else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) values(node.initializer.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return classes;
}
