import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import {
  IdentifierResolution,
  ImportInfo,
  ProcedureResolution,
  TrpcNode,
  TsConfigCache,
} from "../lib/types";
import {
  analyzeProcedureChain,
  clearProcedureAnalysisCaches,
} from "./parserProcedureAnalysis";
import { logger } from "../lib/logging/logger";

const tsConfigPathsCache: TsConfigCache = new Map();

export function findAppRoutersInFile(filePath: string): string[] {
  if (!fs.existsSync(filePath)) {
    logger.logDebug(`findAppRoutersInFile: file does not exist: ${filePath}`);
    return [];
  }

  const content = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
  );

  const results = new Set<string>();

  function visit(node: ts.Node) {
    if (
      ts.isTypeAliasDeclaration(node) &&
      node.name.getText() === "AppRouter" &&
      node.type &&
      ts.isTypeQueryNode(node.type)
    ) {
      results.add(node.type.exprName.getText());
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return Array.from(results);
}

export function findAppRouterInFile(filePath: string): string | null {
  const matches = findAppRoutersInFile(filePath);
  return matches[0] ?? null;
}

export function parseRouterFromFile(
  filePath: string,
  routerVarName: string,
  visited: Set<string> = new Set(),
): TrpcNode | null {
  if (visited.size === 0) {
    clearProcedureAnalysisCaches();
  }

  const key = `${filePath}:${routerVarName}`;
  if (visited.has(key)) {
    logger.logDebug(`parseRouterFromFile: already visited ${key}`);
    return null;
  }
  if (!fs.existsSync(filePath)) {
    logger.logWarning(`parseRouterFromFile: file not found ${filePath}`);
    return null;
  }
  visited.add(key);

  logger.logDebug(`parseRouterFromFile: parsing ${key}`);

  const content = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const imports = getImports(sourceFile);

  const root: TrpcNode = {
    name: routerVarName,
    type: "router",
    children: [],
    filePath,
  };

  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText() === routerVarName &&
      node.initializer
    ) {
      const init = node.initializer;
      if (ts.isCallExpression(init) && isRouterCall(init)) {
        const arg = init.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
          parseRouterObject(arg, root, filePath, imports, visited, sourceFile);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return root;
}

function getImports(sourceFile: ts.SourceFile): Map<string, ImportInfo> {
  const result = new Map<string, ImportInfo>();

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) {
      continue;
    }

    const moduleSpecifier = (stmt.moduleSpecifier as ts.StringLiteral).text;

    if (stmt.importClause.name) {
      result.set(stmt.importClause.name.getText(), {
        moduleSpecifier,
        importName: "default",
        isDefault: true,
      });
    }

    const bindings = stmt.importClause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) {
      continue;
    }

    for (const spec of bindings.elements) {
      const localName = spec.name.getText();
      const importedName = spec.propertyName?.getText() ?? localName;
      result.set(localName, {
        moduleSpecifier,
        importName: importedName,
        isDefault: false,
      });
    }
  }

  return result;
}

function resolveImport(specifier: string, fromFilePath: string): string | null {
  if (specifier.startsWith(".")) {
    return resolveFile(path.resolve(path.dirname(fromFilePath), specifier));
  }

  const tsConfigPaths = getTsConfigPaths(fromFilePath);
  if (!tsConfigPaths) {
    return null;
  }

  const { paths, baseUrl } = tsConfigPaths;
  for (const [pattern, mappings] of Object.entries(paths)) {
    const prefixStr = pattern.replace(/\*$/, "");
    if (!specifier.startsWith(prefixStr)) {
      continue;
    }

    const rest = specifier.slice(prefixStr.length);
    for (const mapping of mappings as string[]) {
      const mappedPath = mapping.replace(/\*$/, "") + rest;
      const resolved = resolveFile(path.resolve(baseUrl, mappedPath));
      if (resolved) {
        return resolved;
      }
    }
  }

  return null;
}

function resolveFile(base: string): string | null {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

function getTsConfigPaths(
  fromFilePath: string,
): { paths: Record<string, string[]>; baseUrl: string } | null {
  let dir = path.dirname(fromFilePath);
  const root = path.parse(dir).root;

  while (dir !== root) {
    if (tsConfigPathsCache.has(dir)) {
      return tsConfigPathsCache.get(dir) ?? null;
    }

    const tsConfigPath = path.join(dir, "tsconfig.json");
    if (fs.existsSync(tsConfigPath)) {
      try {
        const raw = fs.readFileSync(tsConfigPath, "utf8");
        const stripped = raw
          .replace(/\/\/.*$/gm, "")
          .replace(/\/\*[\s\S]*?\*\//g, "");
        const config = JSON.parse(stripped);
        const compilerOptions = config.compilerOptions ?? {};
        const paths = compilerOptions.paths;

        if (paths && typeof paths === "object") {
          const baseUrl = path.resolve(dir, compilerOptions.baseUrl ?? ".");
          const result = { paths, baseUrl };
          tsConfigPathsCache.set(dir, result);
          logger.logDebug(`Found tsconfig with paths at ${tsConfigPath}`);
          return result;
        }
      } catch {
        logger.logWarning(`Invalid tsconfig.json at ${tsConfigPath}`);
      }

      tsConfigPathsCache.set(dir, null);
      return null;
    }

    dir = path.dirname(dir);
  }

  tsConfigPathsCache.set(dir, null);
  return null;
}

function isRouterCall(call: ts.CallExpression): boolean {
  if (ts.isPropertyAccessExpression(call.expression)) {
    return call.expression.name.getText() === "router";
  }

  if (!ts.isIdentifier(call.expression)) {
    return false;
  }

  const name = call.expression.getText();
  return name === "router" || name === "createTRPCRouter";
}

function resolveSchemaText(
  schemaText: string,
  sourceFile: ts.SourceFile,
  imports: Map<string, ImportInfo>,
  filePath: string,
  depth: number = 0,
): string {
  // Prevent infinite loops when aliases reference aliases recursively.
  if (depth > 5) {
    return schemaText;
  }

  const trimmed = schemaText.trim();
  if (trimmed.startsWith("z.") || trimmed.startsWith("{")) {
    return trimmed;
  }

  const identMatch = trimmed.match(/^([A-Za-z_$][\w$]*)([\s\S]*)$/);
  if (!identMatch) {
    return trimmed;
  }

  const identifier = identMatch[1];
  const suffix = identMatch[2];

  const resolved = resolveIdentifierFull(
    identifier,
    sourceFile,
    imports,
    filePath,
  );
  if (!resolved) {
    return trimmed;
  }

  const substituted = resolved.text + suffix;
  if (substituted.startsWith("z.")) {
    return substituted;
  }

  return resolveSchemaText(
    substituted,
    resolved.sourceFile,
    resolved.imports,
    resolved.filePath,
    depth + 1,
  );
}

function resolveIdentifierFull(
  name: string,
  sourceFile: ts.SourceFile,
  imports: Map<string, ImportInfo>,
  filePath: string,
): IdentifierResolution | null {
  const localDef = findVariableInitializer(sourceFile, name);
  if (localDef) {
    return { text: localDef, filePath, sourceFile, imports };
  }

  const importInfo = imports.get(name);
  if (!importInfo) {
    return null;
  }

  const resolvedPath = resolveImport(importInfo.moduleSpecifier, filePath);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return null;
  }

  const importContent = fs.readFileSync(resolvedPath, "utf8");
  const importSf = ts.createSourceFile(
    resolvedPath,
    importContent,
    ts.ScriptTarget.Latest,
    true,
  );
  const importImports = getImports(importSf);
  const targetVar = importInfo.isDefault ? name : importInfo.importName;
  const definition = findVariableInitializer(importSf, targetVar);
  if (!definition) {
    return null;
  }

  return {
    text: definition,
    filePath: resolvedPath,
    sourceFile: importSf,
    imports: importImports,
  };
}

function findVariableInitializer(
  sourceFile: ts.SourceFile,
  varName: string,
): string | null {
  let result: string | null = null;

  function visit(node: ts.Node) {
    if (result) {
      return;
    }

    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText() === varName &&
      node.initializer
    ) {
      result = node.initializer.getText();
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return result;
}

function findVariableDeclarationInfo(
  sourceFile: ts.SourceFile,
  varName: string,
): { initializer: ts.Expression; line: number } | null {
  let result: { initializer: ts.Expression; line: number } | null = null;

  function visit(node: ts.Node) {
    if (result) {
      return;
    }

    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText() === varName &&
      node.initializer
    ) {
      const line =
        sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      result = { initializer: node.initializer, line };
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return result;
}

function resolveIdentifierAsProcedure(
  varName: string,
  currentFilePath: string,
  currentSourceFile: ts.SourceFile,
  currentImports: Map<string, ImportInfo>,
): ProcedureResolution | null {
  const localDecl = findVariableDeclarationInfo(currentSourceFile, varName);
  if (localDecl) {
    const localProc = analyzeProcedureChain(
      localDecl.initializer,
      currentSourceFile,
      currentImports,
      currentFilePath,
      resolveSchemaText,
    );

    if (localProc) {
      return {
        ...localProc,
        filePath: currentFilePath,
        line: localDecl.line,
      };
    }
  }

  const importInfo = currentImports.get(varName);
  if (!importInfo) {
    return null;
  }

  const resolvedPath = resolveImport(
    importInfo.moduleSpecifier,
    currentFilePath,
  );
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return null;
  }

  const importContent = fs.readFileSync(resolvedPath, "utf8");
  const importSf = ts.createSourceFile(
    resolvedPath,
    importContent,
    ts.ScriptTarget.Latest,
    true,
  );
  const importImports = getImports(importSf);
  const targetVar = importInfo.isDefault ? varName : importInfo.importName;
  const importedDecl = findVariableDeclarationInfo(importSf, targetVar);
  if (!importedDecl) {
    return null;
  }

  const importedProc = analyzeProcedureChain(
    importedDecl.initializer,
    importSf,
    importImports,
    resolvedPath,
    resolveSchemaText,
  );

  if (!importedProc) {
    return null;
  }

  return {
    ...importedProc,
    filePath: resolvedPath,
    line: importedDecl.line,
  };
}

function parseRouterObject(
  obj: ts.ObjectLiteralExpression,
  parentNode: TrpcNode,
  filePath: string,
  imports: Map<string, ImportInfo>,
  visited: Set<string>,
  sourceFile: ts.SourceFile,
): void {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const key = prop.name.getText();
      const value = prop.initializer;
      const line =
        sourceFile.getLineAndCharacterOfPosition(prop.getStart()).line + 1;

      const procInfo = analyzeProcedureChain(
        value,
        sourceFile,
        imports,
        filePath,
        resolveSchemaText,
      );
      if (procInfo) {
        parentNode.children.push({
          name: key,
          type: procInfo.type,
          children: [],
          filePath,
          line,
          inputSchema: procInfo.inputSchema,
          outputSchema: procInfo.outputSchema,
        });
        continue;
      }

      if (ts.isIdentifier(value)) {
        const proc = resolveIdentifierAsProcedure(
          value.getText(),
          filePath,
          sourceFile,
          imports,
        );
        if (proc) {
          parentNode.children.push({
            name: key,
            type: proc.type,
            children: [],
            filePath: proc.filePath,
            line: proc.line,
            inputSchema: proc.inputSchema,
            outputSchema: proc.outputSchema,
          });
          continue;
        }

        const child = resolveIdentifierAsRouter(
          value.getText(),
          filePath,
          imports,
          visited,
        );
        if (child) {
          child.name = key;
          parentNode.children.push(child);
          continue;
        }
      }

      if (ts.isCallExpression(value) && isRouterCall(value)) {
        const child: TrpcNode = {
          name: key,
          type: "router",
          children: [],
          filePath,
          line,
        };

        if (
          value.arguments.length > 0 &&
          ts.isObjectLiteralExpression(value.arguments[0])
        ) {
          parseRouterObject(
            value.arguments[0] as ts.ObjectLiteralExpression,
            child,
            filePath,
            imports,
            visited,
            sourceFile,
          );
        }

        parentNode.children.push(child);
        continue;
      }

      parentNode.children.push({
        name: key,
        type: "router",
        children: [],
        filePath,
        line,
      });
      continue;
    }

    if (ts.isShorthandPropertyAssignment(prop)) {
      const key = prop.name.getText();
      const child = resolveIdentifierAsRouter(key, filePath, imports, visited);
      if (child) {
        child.name = key;
        parentNode.children.push(child);
      }
    }
  }
}

function resolveIdentifierAsRouter(
  varName: string,
  currentFilePath: string,
  imports: Map<string, ImportInfo>,
  visited: Set<string>,
): TrpcNode | null {
  const importInfo = imports.get(varName);

  if (importInfo) {
    const resolved = resolveImport(importInfo.moduleSpecifier, currentFilePath);
    if (resolved) {
      const targetVar = importInfo.isDefault ? varName : importInfo.importName;
      return parseRouterFromFile(resolved, targetVar, visited);
    }
  }

  return parseRouterFromFile(currentFilePath, varName, visited);
}
