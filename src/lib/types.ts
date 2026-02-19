import type * as ts from "typescript";

export type ProcedureType = "query" | "mutation" | "subscription";
export type TrpcNodeType = "router" | "file" | ProcedureType;

export interface TrpcNode {
  name: string;
  type: TrpcNodeType;
  children: TrpcNode[];
  filePath?: string;
  line?: number;
  inputSchema?: string;
  outputSchema?: string;
}

export interface AppRouterInfo {
  filePath: string;
  routerVarName: string;
  tree: TrpcNode;
}

export interface ImportInfo {
  moduleSpecifier: string;
  importName: string;
  isDefault: boolean;
}

export interface TsConfigPaths {
  paths: Record<string, string[]>;
  baseUrl: string;
}

export type TsConfigCache = Map<string, TsConfigPaths | null>;

export interface TypeCheckerContext {
  program: ts.Program;
  checker: ts.TypeChecker;
}

export interface IdentifierResolution {
  text: string;
  filePath: string;
  sourceFile: ts.SourceFile;
  imports: Map<string, ImportInfo>;
}

export interface ProcedureResolution {
  type: ProcedureType;
  inputSchema?: string;
  outputSchema?: string;
  filePath: string;
  line?: number;
}

export interface ProcedureAnalysisResult {
  type: ProcedureType;
  inputSchema?: string;
  outputSchema?: string;
}

export interface WebviewTrpcNode {
  name: string;
  type: TrpcNodeType;
  filePath?: string;
  line?: number;
  inputSchema?: string;
  outputSchema?: string;
  prettyInput?: string;
  prettyOutput?: string;
  children: WebviewTrpcNode[];
}

export interface ProcedureCounts {
  query: number;
  mutation: number;
  subscription: number;
}
