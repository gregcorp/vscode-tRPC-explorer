import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import {
  ImportInfo,
  ProcedureAnalysisResult,
  TypeCheckerContext,
} from "../lib/types";
import { logger } from "../lib/logging/logger";

const enumResolutionCache = new Map<string, string | null>();
const nearestTsConfigPathCache = new Map<string, string | null>();
const typeCheckerContextCache = new Map<string, TypeCheckerContext | null>();

export function clearProcedureAnalysisCaches(): void {
  enumResolutionCache.clear();
  nearestTsConfigPathCache.clear();
  typeCheckerContextCache.clear();
  logger.logDebug("Cleared procedure analysis caches");
}

export function analyzeProcedureChain(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  imports: Map<string, ImportInfo>,
  filePath: string,
  resolveSchemaText: (
    schemaText: string,
    sourceFile: ts.SourceFile,
    imports: Map<string, ImportInfo>,
    filePath: string,
  ) => string,
): ProcedureAnalysisResult | null {
  if (!ts.isCallExpression(node)) {
    return null;
  }
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return null;
  }

  const method = node.expression.name.getText();
  if (
    method !== "query" &&
    method !== "mutation" &&
    method !== "subscription"
  ) {
    return null;
  }

  let inputSchema = findMethodInChain(node.expression.expression, "input");
  let outputSchema = findMethodInChain(node.expression.expression, "output");
  const hasExplicitInput = Boolean(inputSchema);
  const hasExplicitOutput = Boolean(outputSchema);

  if (inputSchema) {
    inputSchema = resolveSchemaText(inputSchema, sourceFile, imports, filePath);
  }
  if (outputSchema) {
    outputSchema = resolveSchemaText(
      outputSchema,
      sourceFile,
      imports,
      filePath,
    );
  }

  if (!outputSchema) {
    outputSchema = inferOutputSchemaFromResolver(
      node,
      sourceFile,
      filePath,
      inputSchema,
    );
  }

  const procedureTypeSchemas = inferSchemasFromProcedureType(
    node,
    sourceFile,
    filePath,
  );

  if (
    !hasExplicitInput &&
    procedureTypeSchemas?.inputSchema &&
    !isNonInformativeInferredType(procedureTypeSchemas.inputSchema)
  ) {
    inputSchema = procedureTypeSchemas.inputSchema;
  }

  if (
    !hasExplicitOutput &&
    procedureTypeSchemas?.outputSchema &&
    !isNonInformativeInferredType(procedureTypeSchemas.outputSchema)
  ) {
    outputSchema = procedureTypeSchemas.outputSchema;
  }

  return { type: method, inputSchema, outputSchema };
}

function inferOutputSchemaFromResolver(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  filePath: string,
  inputSchema?: string,
): string | undefined {
  const resolver = node.arguments[0];
  if (!resolver) {
    return undefined;
  }
  if (!ts.isArrowFunction(resolver) && !ts.isFunctionExpression(resolver)) {
    return undefined;
  }

  const returnExpressions = collectReturnExpressions(resolver);
  if (!returnExpressions.length) {
    return undefined;
  }

  const inferredTypes: string[] = [];
  for (const expr of returnExpressions) {
    let inferred = inferTypeFromExpression(expr, inputSchema);
    if (!inferred || isNonInformativeInferredType(inferred)) {
      inferred = inferTypeFromTypeChecker(expr, sourceFile, filePath);
    }
    if (inferred && !isNonInformativeInferredType(inferred)) {
      inferredTypes.push(inferred);
    }
  }

  if (!inferredTypes.length) {
    return undefined;
  }

  const unique = Array.from(new Set(inferredTypes));
  logger.logDebug(
    `Inferred output schema(s) from resolver: ${unique.join(" | ")}`,
  );
  return unique.length === 1 ? unique[0] : unique.join(" | ");
}

function inferSchemasFromProcedureType(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  filePath: string,
): { inputSchema?: string; outputSchema?: string } | null {
  const ctx = getTypeCheckerContext(filePath);
  if (!ctx) {
    return null;
  }

  const programSourceFile = getProgramSourceFile(ctx.program, filePath);
  if (!programSourceFile) {
    return null;
  }

  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  const nodeInProgram = findNodeByRange(programSourceFile, start, end);
  if (!nodeInProgram) {
    return null;
  }

  const type = ctx.checker.getTypeAtLocation(nodeInProgram);
  if (!type) {
    return null;
  }

  const typeText = ctx.checker.typeToString(
    type,
    nodeInProgram,
    ts.TypeFormatFlags.NoTruncation,
  );

  const genericArg = extractTopLevelGenericArg(typeText);
  if (!genericArg) {
    return null;
  }

  const inputSchema = sanitizeTypeText(
    extractTopLevelObjectFieldType(genericArg, "input"),
  );
  let outputSchema = sanitizeTypeText(
    extractTopLevelObjectFieldType(genericArg, "output"),
  );

  if (!inputSchema && !outputSchema) {
    return null;
  }

  if (outputSchema) {
    outputSchema = resolveEnumAliasesInText(
      outputSchema,
      ctx.checker,
      ctx.program,
    );
  }

  return { inputSchema, outputSchema };
}

function extractTopLevelGenericArg(typeText: string): string | undefined {
  const ltIndex = typeText.indexOf("<");
  if (ltIndex < 0) {
    return undefined;
  }

  let depth = 0;
  for (let i = ltIndex; i < typeText.length; i++) {
    const ch = typeText[i];
    if (ch === "<") {
      depth++;
      continue;
    }
    if (ch === ">") {
      depth--;
      if (depth === 0) {
        return typeText.slice(ltIndex + 1, i).trim();
      }
    }
  }

  return undefined;
}

function extractTopLevelObjectFieldType(
  objectText: string,
  fieldName: string,
): string | undefined {
  const text = objectText.trim();
  if (!text.startsWith("{")) {
    return undefined;
  }

  let depthBrace = 0;
  let depthAngle = 0;
  let depthBracket = 0;
  let depthParen = 0;
  let inString: "'" | '"' | "`" | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      inString = ch;
      continue;
    }

    if (ch === "{") {
      depthBrace++;
      continue;
    }
    if (ch === "}") {
      depthBrace--;
      continue;
    }
    if (ch === "<") {
      depthAngle++;
      continue;
    }
    if (ch === ">") {
      depthAngle = Math.max(0, depthAngle - 1);
      continue;
    }
    if (ch === "[") {
      depthBracket++;
      continue;
    }
    if (ch === "]") {
      depthBracket--;
      continue;
    }
    if (ch === "(") {
      depthParen++;
      continue;
    }
    if (ch === ")") {
      depthParen--;
      continue;
    }

    if (
      depthBrace !== 1 ||
      depthAngle !== 0 ||
      depthBracket !== 0 ||
      depthParen !== 0
    ) {
      continue;
    }

    if (text.startsWith(fieldName, i)) {
      const before = i > 0 ? text[i - 1] : "";
      const after = text[i + fieldName.length] ?? "";
      if (/[A-Za-z0-9_$]/.test(before) || /[A-Za-z0-9_$]/.test(after)) {
        continue;
      }

      let cursor = i + fieldName.length;
      while (/\s/.test(text[cursor] ?? "")) {
        cursor++;
      }
      if (text[cursor] === "?") {
        cursor++;
      }
      while (/\s/.test(text[cursor] ?? "")) {
        cursor++;
      }
      if (text[cursor] !== ":") {
        continue;
      }

      cursor++;
      while (/\s/.test(text[cursor] ?? "")) {
        cursor++;
      }

      const valueStart = cursor;
      let valueBrace = 0;
      let valueAngle = 0;
      let valueBracket = 0;
      let valueParen = 0;
      let valueString: "'" | '"' | "`" | null = null;

      for (let j = cursor; j < text.length; j++) {
        const valueChar = text[j];

        if (valueString) {
          if (valueChar === "\\") {
            j++;
            continue;
          }
          if (valueChar === valueString) {
            valueString = null;
          }
          continue;
        }

        if (valueChar === "'" || valueChar === '"' || valueChar === "`") {
          valueString = valueChar;
          continue;
        }
        if (valueChar === "{") {
          valueBrace++;
          continue;
        }
        if (valueChar === "}") {
          if (
            valueBrace === 0 &&
            valueAngle === 0 &&
            valueBracket === 0 &&
            valueParen === 0
          ) {
            return text.slice(valueStart, j).trim();
          }
          valueBrace--;
          continue;
        }
        if (valueChar === "<") {
          valueAngle++;
          continue;
        }
        if (valueChar === ">") {
          valueAngle = Math.max(0, valueAngle - 1);
          continue;
        }
        if (valueChar === "[") {
          valueBracket++;
          continue;
        }
        if (valueChar === "]") {
          valueBracket--;
          continue;
        }
        if (valueChar === "(") {
          valueParen++;
          continue;
        }
        if (valueChar === ")") {
          valueParen--;
          continue;
        }

        if (
          (valueChar === ";" || valueChar === ",") &&
          valueBrace === 0 &&
          valueAngle === 0 &&
          valueBracket === 0 &&
          valueParen === 0
        ) {
          return text.slice(valueStart, j).trim();
        }
      }

      return text.slice(valueStart).trim();
    }
  }

  return undefined;
}

function sanitizeTypeText(typeText: string | undefined): string | undefined {
  if (!typeText) {
    return undefined;
  }

  const withoutImports = typeText.replace(/import\([^)]*\)\./g, "").trim();
  const unwrapped = unwrapKnownWrapperTypes(withoutImports);
  return unwrapped.trim();
}

function unwrapKnownWrapperTypes(typeText: string): string {
  let current = typeText.trim();

  while (true) {
    const match = current.match(/^([A-Za-z_$][\w$.]*)\s*<([\s\S]+)>$/);
    if (!match) {
      return current;
    }

    const wrapper = match[1];
    const genericArg = extractTopLevelGenericArg(current);
    if (!genericArg) {
      return current;
    }

    if (
      wrapper.endsWith(".PrismaPromise") ||
      wrapper === "PrismaPromise" ||
      wrapper === "Promise" ||
      wrapper.includes("Prisma__")
    ) {
      current = genericArg.trim();
      continue;
    }

    return current;
  }
}

function isNonInformativeInferredType(typeText: string): boolean {
  const compact = typeText.replace(/\s+/g, "").trim();
  if (!compact) {
    return true;
  }

  const parts = compact.split("|");
  if (!parts.length) {
    return true;
  }

  return parts.every(
    (part) =>
      part === "any" ||
      part === "any[]" ||
      part === "unknown" ||
      part === "unknown[]" ||
      part === "{[key:string]:unknown;}" ||
      part === "{[key:string]:unknown}" ||
      part === "{[key:string]:unknown;}",
  );
}

function resolveEnumAliasesInText(
  text: string,
  checker: ts.TypeChecker,
  program: ts.Program,
): string {
  return text.replace(
    /\$Enums\.([A-Za-z_]\w*)|(?<=:\s*)([A-Z][A-Za-z_]\w*)\b(?!\s*[<({.])/g,
    (fullMatch, enumName1?: string, enumName2?: string) => {
      const enumName = enumName1 ?? enumName2;
      if (!enumName) {
        return fullMatch;
      }

      if (
        /^(Date|Map|Set|Array|Promise|RegExp|Error|Buffer|String|Number|Boolean|Object|Symbol|BigInt)$/.test(
          enumName,
        )
      ) {
        return fullMatch;
      }

      const cacheKey = `${enumName}`;
      if (enumResolutionCache.has(cacheKey)) {
        return enumResolutionCache.get(cacheKey) ?? fullMatch;
      }

      const resolved = resolveEnumType(enumName, checker, program);
      enumResolutionCache.set(cacheKey, resolved);
      return resolved ?? fullMatch;
    },
  );
}

function resolveEnumType(
  enumName: string,
  checker: ts.TypeChecker,
  program: ts.Program,
): string | null {
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile && !sf.fileName.includes("generated")) {
      continue;
    }

    const fileSymbol = checker.getSymbolAtLocation(sf);
    if (!fileSymbol) {
      continue;
    }

    const exports = checker.getExportsOfModule(fileSymbol);
    for (const exp of exports) {
      if (exp.name === "$Enums") {
        const nsType = checker.getDeclaredTypeOfSymbol(exp);
        const nsSymbol = nsType.getSymbol();
        if (nsSymbol) {
          const members = nsSymbol.members ?? checker.getExportsOfModule(exp);
          if (members) {
            const enumMembers =
              members instanceof Map
                ? Array.from(members.values())
                : Array.isArray(members)
                  ? members
                  : [];
            for (const member of enumMembers) {
              if (member.name === enumName && member.declarations?.length) {
                const result = tryResolveStringLiteralUnion(member, checker);
                if (result) {
                  return result;
                }
              }
            }
          }
        }
      }

      if (exp.name === enumName) {
        const result = tryResolveStringLiteralUnion(exp, checker);
        if (result) {
          return result;
        }
      }
    }
  }

  return null;
}

function tryResolveStringLiteralUnion(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
): string | null {
  const decl = symbol.declarations?.[0];
  if (!decl) {
    return null;
  }

  let type: ts.Type;

  if (ts.isTypeAliasDeclaration(decl)) {
    type = checker.getTypeAtLocation(decl);
  } else if (ts.isVariableDeclaration(decl)) {
    type = checker.getDeclaredTypeOfSymbol(symbol);
    if (!type.isUnion()) {
      type = checker.getTypeOfSymbolAtLocation(symbol, decl);
    }
  } else {
    return null;
  }

  if (type.isUnion()) {
    const allLiterals = type.types.every(
      (t) => !!(t.flags & ts.TypeFlags.StringLiteral),
    );
    if (allLiterals && type.types.length > 0) {
      return type.types
        .map((t) => {
          const s = checker.typeToString(t);
          return s.startsWith('"') ? s : `"${s}"`;
        })
        .join(" | ");
    }
  }

  return null;
}

function collectReturnExpressions(
  resolver: ts.ArrowFunction | ts.FunctionExpression,
): ts.Expression[] {
  if (!ts.isBlock(resolver.body)) {
    return [resolver.body];
  }

  const returns: ts.Expression[] = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionLike(node) && node !== resolver) {
      return;
    }
    if (ts.isReturnStatement(node) && node.expression) {
      returns.push(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(resolver.body);
  return returns;
}

function inferTypeFromExpression(
  expr: ts.Expression,
  inputSchema?: string,
): string | undefined {
  if (ts.isParenthesizedExpression(expr)) {
    return inferTypeFromExpression(expr.expression, inputSchema);
  }
  if (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
    return inferTypeFromExpression(expr.expression, inputSchema);
  }
  if (ts.isNonNullExpression(expr)) {
    return inferTypeFromExpression(expr.expression, inputSchema);
  }

  if (ts.isPropertyAccessExpression(expr)) {
    if (ts.isIdentifier(expr.expression) && expr.expression.text === "input") {
      const guessed = guessInputFieldTypeFromSchema(
        inputSchema,
        expr.name.text,
      );
      if (guessed) {
        return guessed;
      }
    }
    return "unknown";
  }

  if (
    ts.isStringLiteral(expr) ||
    ts.isNoSubstitutionTemplateLiteral(expr) ||
    ts.isTemplateExpression(expr)
  ) {
    return "string";
  }
  if (ts.isNumericLiteral(expr)) {
    return "number";
  }
  if (
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return "boolean";
  }
  if (expr.kind === ts.SyntaxKind.NullKeyword) {
    return "null";
  }
  if (ts.isIdentifier(expr) && expr.getText() === "undefined") {
    return "undefined";
  }

  if (
    ts.isNewExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "Date"
  ) {
    return "Date";
  }

  if (ts.isArrayLiteralExpression(expr)) {
    if (!expr.elements.length) {
      return "unknown[]";
    }
    const itemTypes = expr.elements
      .map((element) =>
        ts.isSpreadElement(element)
          ? undefined
          : inferTypeFromExpression(element, inputSchema),
      )
      .filter((value): value is string => Boolean(value));
    if (!itemTypes.length) {
      return "unknown[]";
    }
    const unique = Array.from(new Set(itemTypes));
    return `${unique.length === 1 ? unique[0] : unique.join(" | ")}[]`;
  }

  if (ts.isObjectLiteralExpression(expr)) {
    if (!expr.properties.length) {
      return "{ }";
    }

    const fields: string[] = [];
    let hasSpread = false;

    for (const prop of expr.properties) {
      if (ts.isSpreadAssignment(prop)) {
        hasSpread = true;
        continue;
      }

      if (ts.isPropertyAssignment(prop)) {
        const key = getPropertyNameText(prop.name);
        if (!key) {
          continue;
        }
        const valueType =
          inferTypeFromExpression(prop.initializer, inputSchema) ?? "unknown";
        fields.push(`${key}: ${valueType};`);
        continue;
      }

      if (ts.isShorthandPropertyAssignment(prop)) {
        fields.push(`${prop.name.getText()}: unknown;`);
        continue;
      }

      if (ts.isMethodDeclaration(prop)) {
        const key = getPropertyNameText(prop.name);
        if (key) {
          fields.push(`${key}: (...args: unknown[]) => unknown;`);
        }
      }
    }

    if (hasSpread) {
      fields.push("[key: string]: unknown;");
    }

    if (!fields.length) {
      return "{ [key: string]: unknown; }";
    }

    return `{ ${fields.join(" ")} }`;
  }

  if (ts.isConditionalExpression(expr)) {
    const whenTrue =
      inferTypeFromExpression(expr.whenTrue, inputSchema) ?? "unknown";
    const whenFalse =
      inferTypeFromExpression(expr.whenFalse, inputSchema) ?? "unknown";
    return whenTrue === whenFalse ? whenTrue : `${whenTrue} | ${whenFalse}`;
  }

  return "unknown";
}

function inferTypeFromTypeChecker(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  filePath: string,
): string | undefined {
  const ctx = getTypeCheckerContext(filePath);
  if (!ctx) {
    return undefined;
  }

  const programSourceFile = getProgramSourceFile(ctx.program, filePath);
  if (!programSourceFile) {
    return undefined;
  }

  const start = expr.getStart(sourceFile);
  const end = expr.getEnd();
  const exprInProgram = findNodeByRange(programSourceFile, start, end);
  if (!exprInProgram) {
    return undefined;
  }

  const type = ctx.checker.getTypeAtLocation(exprInProgram);
  if (!type) {
    return undefined;
  }

  const typeText = typeToDisplayString(type, ctx.checker, exprInProgram);
  const sanitized = sanitizeTypeText(typeText);

  return sanitized
    ? resolveEnumAliasesInText(sanitized, ctx.checker, ctx.program)
    : undefined;
}

function typeToDisplayString(
  type: ts.Type,
  checker: ts.TypeChecker,
  location: ts.Node,
  seen: Set<number> = new Set(),
): string {
  const typeId = (type as { id?: number }).id;
  if (typeof typeId === "number") {
    if (seen.has(typeId)) {
      return checker.typeToString(
        type,
        location,
        ts.TypeFormatFlags.NoTruncation,
      );
    }
    seen.add(typeId);
  }

  if (type.aliasSymbol && !type.isUnion()) {
    const aliasDecl = type.aliasSymbol.declarations?.[0];
    if (aliasDecl && ts.isTypeAliasDeclaration(aliasDecl)) {
      const aliasedType = checker.getTypeAtLocation(aliasDecl);
      if (aliasedType && aliasedType.isUnion()) {
        const allLiterals = aliasedType.types.every(
          (t) => !!(t.flags & ts.TypeFlags.StringLiteral),
        );
        if (allLiterals) {
          return aliasedType.types
            .map((t) => `"${checker.typeToString(t).replace(/^"|"$/g, "")}"`)
            .join(" | ");
        }
      }
    }
  }

  if (type.isUnion()) {
    const allLiterals = type.types.every(
      (t) => !!(t.flags & ts.TypeFlags.StringLiteral),
    );
    if (allLiterals) {
      return type.types
        .map((t) => `"${checker.typeToString(t).replace(/^"|"$/g, "")}"`)
        .join(" | ");
    }
    const unionParts = type.types.map((part) =>
      typeToDisplayString(part, checker, location, seen),
    );
    return Array.from(new Set(unionParts)).join(" | ");
  }

  if (checker.isArrayType(type)) {
    const typeArgs = checker.getTypeArguments(type as ts.TypeReference);
    const itemType = typeArgs[0];
    if (!itemType) {
      return "unknown[]";
    }
    return `${typeToDisplayString(itemType, checker, location, seen)}[]`;
  }

  const properties = checker.getPropertiesOfType(type);
  const callSignatures = checker.getSignaturesOfType(
    type,
    ts.SignatureKind.Call,
  );
  const constructSignatures = checker.getSignaturesOfType(
    type,
    ts.SignatureKind.Construct,
  );
  const isPlainObject =
    properties.length > 0 &&
    callSignatures.length === 0 &&
    constructSignatures.length === 0 &&
    !(type.flags & ts.TypeFlags.StringLike) &&
    !(type.flags & ts.TypeFlags.NumberLike) &&
    !(type.flags & ts.TypeFlags.BooleanLike) &&
    !(type.flags & ts.TypeFlags.EnumLike) &&
    !type.getStringIndexType() &&
    !type.getNumberIndexType();

  if (isPlainObject) {
    const parts: string[] = [];
    for (const prop of properties) {
      const propType = checker.getTypeOfSymbolAtLocation(prop, location);
      const isOptional = !!(prop.flags & ts.SymbolFlags.Optional);
      const resolvedType = typeToDisplayString(
        propType,
        checker,
        location,
        seen,
      );
      parts.push(`${prop.name}${isOptional ? "?" : ""}: ${resolvedType}`);
    }
    return `{ ${parts.join("; ")}; }`;
  }

  const aliasDecl = type.aliasSymbol?.declarations?.[0];
  if (aliasDecl && ts.isTypeAliasDeclaration(aliasDecl)) {
    return sanitizeTypeText(aliasDecl.type.getText()) ?? "unknown";
  }

  return checker.typeToString(type, location, ts.TypeFormatFlags.NoTruncation);
}

function findNodeByRange(
  root: ts.Node,
  start: number,
  end: number,
): ts.Node | undefined {
  let found: ts.Node | undefined;

  function visit(node: ts.Node) {
    if (found) {
      return;
    }

    if (node.getStart() === start && node.getEnd() === end) {
      found = node;
      return;
    }

    if (node.getFullStart() <= start && node.getEnd() >= end) {
      ts.forEachChild(node, visit);
    }
  }

  visit(root);
  return found;
}

function getProgramSourceFile(
  program: ts.Program,
  filePath: string,
): ts.SourceFile | undefined {
  const direct = program.getSourceFile(filePath);
  if (direct) {
    return direct;
  }

  const normalized = path.normalize(filePath);
  return program
    .getSourceFiles()
    .find((sf) => path.normalize(sf.fileName) === normalized);
}

function getTypeCheckerContext(filePath: string): TypeCheckerContext | null {
  const tsConfigPath = findNearestTsConfigFile(filePath);
  if (!tsConfigPath) {
    logger.logDebug(`No tsconfig found for ${filePath}`);
    return null;
  }

  if (typeCheckerContextCache.has(tsConfigPath)) {
    return typeCheckerContextCache.get(tsConfigPath) ?? null;
  }

  const context = createTypeCheckerContext(tsConfigPath, filePath);
  if (!context) {
    logger.logWarning(
      `Unable to create type checker context for ${tsConfigPath}`,
    );
  } else {
    logger.logDebug(`Created type checker context for ${tsConfigPath}`);
  }
  typeCheckerContextCache.set(tsConfigPath, context);
  return context;
}

function createTypeCheckerContext(
  tsConfigPath: string,
  targetFilePath: string,
): TypeCheckerContext | null {
  const config = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
  if (config.error) {
    return null;
  }

  const parseHost: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    readDirectory: ts.sys.readDirectory,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
  };

  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    parseHost,
    path.dirname(tsConfigPath),
  );

  const normalizedTarget = path.normalize(targetFilePath);
  const rootNames = parsed.fileNames.some(
    (name) => path.normalize(name) === normalizedTarget,
  )
    ? parsed.fileNames
    : [...parsed.fileNames, targetFilePath];

  const host = ts.createCompilerHost(parsed.options);
  const tsLibDir = findTypeScriptLibDir(path.dirname(tsConfigPath));
  if (tsLibDir) {
    host.getDefaultLibLocation = () => tsLibDir;
    const origGetDefaultLibFileName = host.getDefaultLibFileName.bind(host);
    host.getDefaultLibFileName = (options: ts.CompilerOptions) => {
      const defaultName = origGetDefaultLibFileName(options);
      return path.join(tsLibDir, path.basename(defaultName));
    };
  }

  const program = ts.createProgram({
    rootNames,
    options: parsed.options,
    host,
  });

  return {
    program,
    checker: program.getTypeChecker(),
  };
}

function findTypeScriptLibDir(projectDir: string): string | null {
  let dir = projectDir;
  while (true) {
    const candidate = path.join(dir, "node_modules", "typescript", "lib");
    if (fs.existsSync(path.join(candidate, "lib.d.ts"))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

function findNearestTsConfigFile(fromFilePath: string): string | null {
  const initialDir = path.dirname(fromFilePath);
  let dir = initialDir;
  const root = path.parse(dir).root;

  while (true) {
    if (nearestTsConfigPathCache.has(dir)) {
      return nearestTsConfigPathCache.get(dir) ?? null;
    }

    const tsConfigPath = path.join(dir, "tsconfig.json");
    if (fs.existsSync(tsConfigPath)) {
      nearestTsConfigPathCache.set(dir, tsConfigPath);
      return tsConfigPath;
    }

    if (dir === root) {
      break;
    }

    dir = path.dirname(dir);
  }

  nearestTsConfigPathCache.set(initialDir, null);
  return null;
}

function guessInputFieldTypeFromSchema(
  inputSchema: string | undefined,
  fieldName: string,
): string | undefined {
  if (!inputSchema) {
    return undefined;
  }

  const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const primitiveMap: Record<string, string> = {
    string: "string",
    number: "number",
    boolean: "boolean",
    date: "Date",
    bigint: "bigint",
    unknown: "unknown",
    any: "any",
    null: "null",
    undefined: "undefined",
  };

  const baseMatch = inputSchema.match(
    new RegExp(
      `${escapedField}\\s*:\\s*z\\.(string|number|boolean|date|bigint|unknown|any|null|undefined)\\s*\\(`,
    ),
  );

  if (!baseMatch) {
    return undefined;
  }

  const primitive = primitiveMap[baseMatch[1]];
  if (!primitive) {
    return undefined;
  }

  const optionalMatch = inputSchema.match(
    new RegExp(`${escapedField}[\\s\\S]*?\\.optional\\s*\\(`),
  );
  if (optionalMatch) {
    return `${primitive} | undefined`;
  }

  const nullableMatch = inputSchema.match(
    new RegExp(`${escapedField}[\\s\\S]*?\\.nullable\\s*\\(`),
  );
  if (nullableMatch) {
    return `${primitive} | null`;
  }

  return primitive;
}

function getPropertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) {
    return name.getText();
  }
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    return undefined;
  }
  return undefined;
}

function findMethodInChain(
  node: ts.Expression,
  methodName: string,
): string | undefined {
  if (!ts.isCallExpression(node)) {
    return undefined;
  }
  if (ts.isPropertyAccessExpression(node.expression)) {
    if (
      node.expression.name.getText() === methodName &&
      node.arguments.length > 0
    ) {
      return node.arguments[0].getText();
    }
    return findMethodInChain(node.expression.expression, methodName);
  }
  return undefined;
}
