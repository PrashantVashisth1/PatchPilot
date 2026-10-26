// ---------------------------------------------------------------------------
// PatchPilot — AST parser (TypeScript Compiler API)
//
// Static, syntactic analysis of a single source file. No type checking, no
// tsconfig resolution, no code execution — only what the syntax tree states.
//
// Detected facts:
//   - relative imports (static, dynamic `import()`, `require()`, re-exports)
//   - named/default/type-only exports, exported declarations and re-exports
//   - Express-style routes (app/router.get/post/put/patch/delete/use/...)
//   - React Router routes (<Route path="..."/> and createBrowserRouter objects)
//
// Not detected (documented limitations):
//   - non-relative (package) imports — intentionally excluded
//   - computed/dynamic path expressions (`import(prefix + "/x")`)
//   - `export =` (CJS export-assignment)
// ---------------------------------------------------------------------------

import ts from "typescript";
import type { ExportInfo, ImportInfo, RouteInfo } from "@patchpilot/shared";
import { isRelativeSpecifier } from "./resolve.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AstFacts {
  exports: ExportInfo[];
  imports: ImportInfo[];
  routes: RouteInfo[];
  /** Export name -> normalized signature text (for base/head comparison). */
  exportSignatures: Map<string, string>;
}

export interface AstParseResult {
  /** False when the source has syntax errors; facts are then unreliable. */
  ok: boolean;
  /** Human-readable parse error (first diagnostic). */
  error?: string;
  facts: AstFacts;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Express route methods (plus `use`, `all`, `head`, `options`). */
const EXPRESS_METHODS = new Set([
  "get", "post", "put", "patch", "delete", "use", "all", "head", "options",
]);

/** React Router route-config creator calls whose object args are scanned. */
const ROUTER_CREATORS = new Set([
  "createBrowserRouter", "createHashRouter", "createMemoryRouter", "useRoutes",
]);

// ---------------------------------------------------------------------------
// Internal visitor context
// ---------------------------------------------------------------------------

interface DeclEntry {
  kind: ExportInfo["kind"];
  sig: string;
}

interface Ctx {
  sf: ts.SourceFile;
  facts: AstFacts;
  /** Local declarations by name, used to resolve `export { a }` specifiers. */
  declIndex: Map<string, DeclEntry>;
}

/** SourceFile augmented with the (runtime-stable) parseDiagnostics field. */
interface SourceFileWithDiagnostics extends ts.SourceFile {
  parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parseSource(filePath: string, content: string): AstParseResult {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    false,
    scriptKindFor(filePath),
  );

  const facts: AstFacts = {
    exports: [],
    imports: [],
    routes: [],
    exportSignatures: new Map(),
  };

  // Syntax errors: the parser produces a best-effort tree, so facts from a
  // broken file are unreliable — report the error and let the caller skip.
  const diagnostics = (sourceFile as SourceFileWithDiagnostics).parseDiagnostics;
  if (diagnostics && diagnostics.length > 0) {
    const first = diagnostics[0];
    const { line } = sourceFile.getLineAndCharacterOfPosition(first.start);
    const message = ts.flattenDiagnosticMessageText(first.messageText, " ");
    return {
      ok: false,
      error: `Syntax error at line ${line + 1}: ${message}`,
      facts,
    };
  }

  const ctx: Ctx = {
    sf: sourceFile,
    facts,
    declIndex: new Map(),
  };

  // Pass 1: index all local declarations (anywhere in the file) so that
  // `export { a }` specifiers resolve kinds regardless of source ordering.
  indexDeclarations(sourceFile, ctx);

  // Pass 2: collect imports, exports, and routes.
  collectFacts(sourceFile, ctx);

  return { ok: true, facts };
}

// ---------------------------------------------------------------------------
// Pass 1: declaration indexing
// ---------------------------------------------------------------------------

function indexDeclarations(node: ts.Node, ctx: Ctx): void {
  indexDeclarationNode(node, ctx);
  ts.forEachChild(node, (child) => indexDeclarations(child, ctx));
}

function indexDeclarationNode(node: ts.Node, ctx: Ctx): void {
  if (ts.isFunctionDeclaration(node) && node.name) {
    indexDeclaration(node, node.name.text, "function", ctx);
  } else if (ts.isClassDeclaration(node) && node.name) {
    indexDeclaration(node, node.name.text, "class", ctx);
  } else if (ts.isTypeAliasDeclaration(node)) {
    indexDeclaration(node, node.name.text, "type", ctx);
  } else if (ts.isInterfaceDeclaration(node)) {
    indexDeclaration(node, node.name.text, "interface", ctx);
  } else if (ts.isEnumDeclaration(node)) {
    indexDeclaration(node, node.name.text, "enum", ctx);
  } else if (ts.isVariableStatement(node)) {
    const kind = variableKind(node.declarationList.flags);
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) {
        indexDeclaration(node, decl.name.text, kind, ctx, decl);
      } else if (
        ts.isObjectBindingPattern(decl.name) ||
        ts.isArrayBindingPattern(decl.name)
      ) {
        for (const element of decl.name.elements) {
          if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
            indexDeclaration(node, element.name.text, kind, ctx, decl);
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pass 2: fact collection
// ---------------------------------------------------------------------------

function collectFacts(node: ts.Node, ctx: Ctx): void {
  dispatch(node, ctx);
  ts.forEachChild(node, (child) => collectFacts(child, ctx));
}

function dispatch(node: ts.Node, ctx: Ctx): void {
  if (ts.isImportDeclaration(node)) return handleImport(node, ctx);
  if (ts.isExportDeclaration(node)) return handleExportDeclaration(node, ctx);
  if (ts.isExportAssignment(node)) return handleExportAssignment(node, ctx);

  if (ts.isFunctionDeclaration(node)) {
    return handleExportedDeclaration(node, "function", ctx);
  }
  if (ts.isClassDeclaration(node)) {
    return handleExportedDeclaration(node, "class", ctx);
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return handleExportedDeclaration(node, "type", ctx);
  }
  if (ts.isInterfaceDeclaration(node)) {
    return handleExportedDeclaration(node, "interface", ctx);
  }
  if (ts.isEnumDeclaration(node)) {
    return handleExportedDeclaration(node, "enum", ctx);
  }
  if (ts.isVariableStatement(node)) {
    handleVariableStatement(node, ctx);
    return;
  }

  if (ts.isCallExpression(node)) {
    handleCallExpression(node, ctx);
    return;
  }

  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    handleJsxRouteElement(node, ctx);
  }
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

function handleImport(node: ts.ImportDeclaration, ctx: Ctx): void {
  const moduleSpecifier = node.moduleSpecifier;
  if (!ts.isStringLiteral(moduleSpecifier)) return;
  const specifier = moduleSpecifier.text;
  if (!isRelativeSpecifier(specifier)) return;

  const line = lineOf(node, ctx);
  const names: string[] = [];
  let namespace: string | undefined;
  let isTypeOnly = false;

  const clause = node.importClause;
  if (clause) {
    if (clause.isTypeOnly) isTypeOnly = true;
    if (clause.name) names.push("default");
    if (clause.namedBindings) {
      if (ts.isNamedImports(clause.namedBindings)) {
        const elements = clause.namedBindings.elements;
        for (const el of elements) names.push(el.name.text);
        if (elements.length > 0 && elements.every((el) => el.isTypeOnly)) {
          isTypeOnly = true;
        }
      } else if (ts.isNamespaceImport(clause.namedBindings)) {
        namespace = clause.namedBindings.name.text;
      }
    }
  }

  ctx.facts.imports.push({
    source: specifier,
    names,
    line,
    isTypeOnly: isTypeOnly || undefined,
    namespace,
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

function handleExportDeclaration(node: ts.ExportDeclaration, ctx: Ctx): void {
  const line = lineOf(node, ctx);

  // --- export { a, b }; (no module specifier) — resolve against local decls
  if (!node.moduleSpecifier) {
    const clause = node.exportClause;
    if (clause && ts.isNamedExports(clause)) {
      for (const el of clause.elements) {
        const decl = ctx.declIndex.get(el.name.text);
        ctx.facts.exports.push({
          name: el.name.text,
          kind: decl?.kind ?? "unknown",
          signatureChanged: false,
          line,
          isTypeOnly: el.isTypeOnly || undefined,
        });
        ctx.facts.exportSignatures.set(
          el.name.text,
          decl?.sig ?? `export:${el.name.text}`,
        );
      }
    }
    return;
  }

  // --- re-exports: export { a } from "./m" / export * from "./m"
  const moduleSpecifier = node.moduleSpecifier;
  if (!ts.isStringLiteral(moduleSpecifier)) return;
  const specifier = moduleSpecifier.text;
  const relative = isRelativeSpecifier(specifier);

  // `export type { T } from "..."` puts the type marker on the declaration
  // (node.isTypeOnly); `export { type T } from "..."` marks each specifier.
  const declIsTypeOnly = node.isTypeOnly;

  const addImport = (names: string[], namespace?: string, isTypeOnly?: boolean): void => {
    if (!relative) return;
    ctx.facts.imports.push({
      source: specifier,
      names,
      line,
      namespace,
      isTypeOnly: isTypeOnly || undefined,
    });
  };

  const clause = node.exportClause;
  if (clause && ts.isNamedExports(clause)) {
    const elements = clause.elements;
    const allTypeOnly =
      declIsTypeOnly ||
      (elements.length > 0 && elements.every((el) => el.isTypeOnly));
    const names = elements.map((el) => el.name.text);
    addImport(names, undefined, allTypeOnly);
    for (const el of elements) {
      ctx.facts.exports.push({
        name: el.name.text,
        kind: "unknown",
        signatureChanged: false,
        line,
        isTypeOnly: (el.isTypeOnly || allTypeOnly) || undefined,
        reExportedFrom: specifier,
      });
      ctx.facts.exportSignatures.set(el.name.text, `re-export:${specifier}`);
    }
  } else if (clause && ts.isNamespaceExport(clause)) {
    // export * as ns from "./m"
    const name = clause.name.text;
    addImport([], name, declIsTypeOnly);
    ctx.facts.exports.push({
      name,
      kind: "unknown",
      signatureChanged: false,
      line,
      isTypeOnly: declIsTypeOnly || undefined,
      reExportedFrom: specifier,
    });
    ctx.facts.exportSignatures.set(name, `re-export:*as:${specifier}`);
  } else {
    // export * from "./m"
    addImport([], undefined, declIsTypeOnly);
    ctx.facts.exports.push({
      name: "*",
      kind: "unknown",
      signatureChanged: false,
      line,
      isTypeOnly: declIsTypeOnly || undefined,
      reExportedFrom: specifier,
    });
    ctx.facts.exportSignatures.set("*", `re-export:*:${specifier}`);
  }
}

function handleExportAssignment(node: ts.ExportAssignment, ctx: Ctx): void {
  // `export =` (CJS) is a documented limitation; only `export default`.
  if (node.isExportEquals) return;

  const line = lineOf(node, ctx);
  ctx.facts.exports.push({
    name: "default",
    kind: classifyExpression(node.expression, ctx),
    signatureChanged: false,
    line,
  });
  ctx.facts.exportSignatures.set("default", normalizedText(node.expression, ctx));
}

function handleExportedDeclaration(
  node: ts.Node & { name?: ts.Identifier },
  kind: ExportInfo["kind"],
  ctx: Ctx,
): void {
  const isExported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
  if (!isExported) return;

  const isDefault = hasModifier(node, ts.SyntaxKind.DefaultKeyword);
  const declName = node.name?.text;
  const exportName = isDefault ? "default" : declName;
  if (!exportName) return;

  const typeOnly = kind === "type" || kind === "interface";

  ctx.facts.exports.push({
    name: exportName,
    kind,
    signatureChanged: false,
    line: lineOf(node, ctx),
    isTypeOnly: typeOnly || undefined,
  });
  ctx.facts.exportSignatures.set(
    exportName,
    declName ? (ctx.declIndex.get(declName)?.sig ?? normalizedText(node, ctx)) : normalizedText(node, ctx),
  );
}

function handleVariableStatement(node: ts.VariableStatement, ctx: Ctx): void {
  const isExported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
  const varKind = variableKind(node.declarationList.flags);

  for (const decl of node.declarationList.declarations) {
    if (ts.isIdentifier(decl.name)) {
      indexDeclaration(node, decl.name.text, varKind, ctx, decl);
      if (isExported) {
        ctx.facts.exports.push({
          name: decl.name.text,
          kind: varKind,
          signatureChanged: false,
          line: lineOf(node, ctx),
        });
        ctx.facts.exportSignatures.set(
          decl.name.text,
          ctx.declIndex.get(decl.name.text)?.sig ?? normalizedText(decl, ctx),
        );
      }
    } else if (ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name)) {
      // export const { a, b } = obj; — export each bound name.
      for (const element of decl.name.elements) {
        if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
          const name = element.name.text;
          indexDeclaration(node, name, varKind, ctx, decl);
          if (isExported) {
            ctx.facts.exports.push({
              name,
              kind: varKind,
              signatureChanged: false,
              line: lineOf(node, ctx),
            });
            ctx.facts.exportSignatures.set(
              name,
              ctx.declIndex.get(name)?.sig ?? normalizedText(decl, ctx),
            );
          }
        }
      }
    }
  }
}

function indexDeclaration(
  _node: ts.Node,
  name: string | undefined,
  kind: ExportInfo["kind"],
  ctx: Ctx,
  sigNode?: ts.Node,
): void {
  if (!name) return;
  ctx.declIndex.set(name, {
    kind,
    sig: normalizedText(sigNode ?? _node, ctx),
  });
}

function classifyExpression(expr: ts.Expression, ctx: Ctx): ExportInfo["kind"] {
  if (ts.isFunctionExpression(expr) || ts.isArrowFunction(expr)) return "function";
  if (ts.isClassExpression(expr)) return "class";
  if (ts.isIdentifier(expr)) {
    return ctx.declIndex.get(expr.text)?.kind ?? "unknown";
  }
  if (ts.isParenthesizedExpression(expr)) {
    return classifyExpression(expr.expression, ctx);
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function handleCallExpression(node: ts.CallExpression, ctx: Ctx): void {
  // Express-style: app.get("/x", handler), router.use("/api", r), ...
  if (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression)
  ) {
    const method = node.expression.name.text;
    if (EXPRESS_METHODS.has(method)) {
      const first = node.arguments[0];
      // Requiring a path literal + at least one more argument (handler)
      // filters out lookalikes like map.get(key).
      if (node.arguments.length >= 2 && isStringLike(first)) {
        ctx.facts.routes.push({
          method: method.toUpperCase(),
          path: first.text,
          line: lineOf(node, ctx),
          framework: "express",
        });
      }
    }
  }

  // React Router creators: createBrowserRouter([{ path: "/x", ... }])
  if (ts.isIdentifier(node.expression) && ROUTER_CREATORS.has(node.expression.text)) {
    for (const arg of node.arguments) {
      collectRouterObjectRoutes(arg, ctx);
    }
  }

  // Dynamic import("./x")
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const arg = node.arguments[0];
    if (arg && isStringLike(arg) && isRelativeSpecifier(arg.text)) {
      ctx.facts.imports.push({
        source: arg.text,
        names: [],
        line: lineOf(node, ctx),
        dynamic: true,
      });
    }
  }

  // require("./x")
  if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
    const arg = node.arguments[0];
    if (arg && isStringLike(arg) && isRelativeSpecifier(arg.text)) {
      ctx.facts.imports.push({
        source: arg.text,
        names: [],
        line: lineOf(node, ctx),
        dynamic: true,
      });
    }
  }
}

function handleJsxRouteElement(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  ctx: Ctx,
): void {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const tag = opening.tagName;
  if (!(ts.isIdentifier(tag) && tag.text === "Route")) return;

  for (const prop of opening.attributes.properties) {
    if (
      ts.isJsxAttribute(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === "path" &&
      prop.initializer &&
      isStringLike(prop.initializer)
    ) {
      ctx.facts.routes.push({
        method: "ROUTE",
        path: prop.initializer.text,
        line: lineOf(node, ctx),
        framework: "react-router",
      });
    }
  }
}

function collectRouterObjectRoutes(node: ts.Node, ctx: Ctx): void {
  if (ts.isObjectLiteralExpression(node)) {
    for (const prop of node.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === "path" &&
        isStringLike(prop.initializer)
      ) {
        ctx.facts.routes.push({
          method: "ROUTE",
          path: prop.initializer.text,
          line: lineOf(prop, ctx),
          framework: "react-router",
        });
      }
    }
  }
  ts.forEachChild(node, (child) => collectRouterObjectRoutes(child, ctx));
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function scriptKindFor(filePath: string): ts.ScriptKind {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const modifiers = (node as { modifiers?: readonly ts.ModifierLike[] }).modifiers;
  if (!modifiers) return false;
  return modifiers.some((m) => m.kind === kind);
}

function variableKind(flags: ts.NodeFlags): ExportInfo["kind"] {
  if (flags & ts.NodeFlags.Const) return "const";
  if (flags & ts.NodeFlags.Let) return "let";
  return "var";
}

function isStringLike(node: ts.Expression | undefined): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  if (!node) return false;
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function lineOf(node: ts.Node, ctx: Ctx): number {
  // Pass the source file explicitly: nodes were created without parent
  // pointers, so getStart() cannot walk up to find it.
  return ctx.sf.getLineAndCharacterOfPosition(node.getStart(ctx.sf)).line + 1;
}

/**
 * Normalized declaration text for base/head comparison: all whitespace
 * removed (deterministic formatting-insensitivity). Known theoretical
 * limitation: distinct token sequences that differ only in whitespace
 * (e.g. `let x` vs a identifier `letx`) collapse to the same signature.
 */
function normalizedText(node: ts.Node, ctx: Ctx): string {
  return node
    .getText(ctx.sf)
    .replace(/\s+/g, "")
    .slice(0, 200);
}