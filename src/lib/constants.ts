import * as vscode from "vscode";
import { TrpcNodeType } from "./types";

export const NODE_MODULES_GLOB = "**/node_modules/**";

export const APP_ROUTER_DISPLAY_NAME = "AppRouter";

export const ROUTER_DISCOVERY_PATTERNS = [
  "**/root.ts",
  "**/trpc.ts",
  "**/_app.ts",
  "**/server/**/*.ts",
  "**/api/**/*.ts",
];

// @TODO: change icons
export const TRPC_TREE_ICONS: Record<TrpcNodeType, vscode.ThemeIcon> = {
  router: new vscode.ThemeIcon(
    "symbol-namespace",
    new vscode.ThemeColor("charts.purple"),
  ),
  file: new vscode.ThemeIcon("file", new vscode.ThemeColor("charts.yellow")),
  query: new vscode.ThemeIcon("search", new vscode.ThemeColor("charts.blue")),
  mutation: new vscode.ThemeIcon(
    "edit",
    new vscode.ThemeColor("charts.orange"),
  ),
  subscription: new vscode.ThemeIcon(
    "pulse",
    new vscode.ThemeColor("charts.green"),
  ),
};
