import * as z from "zod";
import { zodToTs, printNode, createAuxiliaryTypeStore } from "zod-to-ts";
import { logger } from "./logging/logger";

export function zodExpressionToReadableType(expression: string): string {
  const trimmedExpression = expression.trim();
  if (!trimmedExpression) {
    return expression;
  }

  try {
    const schema = evaluateZodExpression(trimmedExpression);
    if (!isZodSchemaLike(schema)) {
      logger.logDebug(
        "zodPrettifier: expression did not evaluate to zod schema",
        {
          expression: trimmedExpression,
        },
      );
      return simplifyZodExpressionForDisplay(expression);
    }

    const { node } = zodToTs(schema, {
      auxiliaryTypeStore: createAuxiliaryTypeStore(),
    });
    const printed = printNode(node);
    return compactTypeForSidebar(printed);
  } catch {
    logger.logWarning("zodPrettifier: failed to parse zod expression", {
      expression: trimmedExpression,
    });
    return simplifyZodExpressionForDisplay(expression);
  }
}

export const prettifyZodSchema = zodExpressionToReadableType;

function evaluateZodExpression(expression: string): unknown {
  const evaluate = new Function("z", `"use strict"; return (${expression});`);
  return evaluate(z);
}

function isZodSchemaLike(value: unknown): value is z.ZodTypeAny {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { parse?: unknown }).parse === "function"
  );
}

function compactTypeForSidebar(printedType: string): string {
  const decodedType = decodeUnicodeEscapes(printedType);
  const lines = decodedType.split("\n");

  if (lines.length <= 5) {
    const singleLine = decodedType
      .replace(/\n\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (singleLine.length <= 80) {
      return singleLine;
    }
  }

  return decodedType;
}

function decodeUnicodeEscapes(source: string): string {
  return source.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

function simplifyZodExpressionForDisplay(expression: string): string {
  let simplified = expression.trim();
  if (simplified.startsWith("z.")) {
    simplified = simplified.replace(/^z\./, "").replace(/\(\s*\)$/, "");
  }

  return simplified;
}
