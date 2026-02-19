# How It Works

## Introduction

This document explains the core concepts the extension relies on so maintainers and contributors understand what we call "procedures", how they are typed, and what the extension extracts and displays.

- Procedure: a single tRPC endpoint defined on a router. Procedures are created by chaining calls such as `router().query(...)`, `router().mutation(...)` or `router().subscription(...)` and represent the smallest unit the explorer shows.
- Procedure types: `query`, `mutation`, `subscription`. The extension recognizes these by the final call in the chain and categorizes nodes accordingly.
- Input / Output schemas: procedures can declare explicit schemas with `.input(...)` and `.output(...)` using Zod or other schema builders. When present they are shown verbatim; we also attempt to produce a prettified TypeScript-like representation for readability.
- Resolver: the function that implements the procedure. When `.output(...)` is missing, the extension inspects resolver return expressions and, if needed, asks the TypeScript `TypeChecker` for the procedural generic type to infer input/output shapes.
- Routers: collections of procedures organized as nested object literals passed to `router(...)` or created with `createTRPCRouter(...)`. Routers can reference other routers via identifiers or imports — the parser resolves these across files and follows `tsconfig` path aliases when configured.
- Zod inline expressions: when a schema is an inline Zod expression (e.g. starts with `z.`) the extension evaluates and converts it to a readable TypeScript representation using `zod-to-ts`. If evaluation fails we fall back to a cleaned textual form.
- Caching & safety: filesystem/AST operations and TypeChecker contexts are cached (per-`tsconfig`) to keep performance acceptable. We limit recursive resolution depth and protect against cyclical imports.

The rest of this file describes the implementation details (discovery, AST parsing, inference heuristics, webview wiring and security) used to build the UI shown in the VS Code sidebar.

## Extension Activation

When the extension is activated:

- `src/extension.ts` registers `TrpcWebviewProvider` as a `WebviewViewProvider`.
- A `FileSystemWatcher("**/*.ts")` listens for create/change/delete events.
- Any TypeScript file change triggers `provider.refresh()`.
- The command `trpc-explorer.refresh` also triggers a manual refresh.

---

## Process of searching for routers

Router discovery starts in `discoverAppRouterTrees()` (`src/routerDiscovery.ts`):

1. Search priority paths first (for example `root.ts`, `trpc.ts`, `_app.ts`, `server/**/*.ts`, `api/**/*.ts`).
2. Then scan all remaining `**/*.ts` files.
3. Ignore `node_modules` (`NODE_MODULES_GLOB`).
4. De-duplicate files and parse keys (`filePath:routerVarName`) to avoid repeated work.

For each candidate file, the parser looks for:

```ts
export type AppRouter = typeof appRouter;
```

Then it resolves and parses the referenced router variable.

---

## Parsing of routers using AST

The core parser (`src/parser.ts`) uses the TypeScript compiler API (`ts.createSourceFile`) and builds a `TrpcNode` tree:

- Detect router declarations (`router(...)` or `createTRPCRouter(...)`).
- Parse object-literal router structure recursively.
- Resolve shorthand/identifier children across imports.
- Resolve relative imports and `tsconfig` path aliases (`compilerOptions.paths` + `baseUrl`).
- Cache the `(file, variable)` pairs to prevent cyclic recursion.

---

## Analysis of procedures

Procedure analysis lives in `src/parserProcedureAnalysis.ts`.

For each candidate procedure chain (`query`, `mutation`, `subscription`):

- Extract explicit `.input(...)` / `.output(...)` when present.
- If `output` is missing, infer from resolver return expressions.
- If still incomplete, use TypeScript `TypeChecker` from nearest `tsconfig.json` to infer generic input/output types.
- Normalize noisy/informationally-poor types and attempt enum alias resolution (including Prisma-style enum text expansion).
- Cache most things (`tsconfig` path, checker context, enum resolutions) for speed.

---

## Zod to redeable types

`src/zodPrettifier.ts` converts inline Zod expressions into readable TypeScript:

- Evaluate expression with `z` in scope.
- Convert with `zod-to-ts` (`zodToTs` + `printNode`).
- Compact short types for sidebar readability.
- Fallback to a simplified raw expression when evaluation fails.

The webview payload includes both raw schema text and prettified variants (`prettyInput`, `prettyOutput`).

---

## UI rendering

The VS Code host side (`src/webviewProvider.ts`):

- Loads `dist/webview/index.html` (built from `webview-ui`).
- Injects CSP, nonce, and VS Code-safe asset URIs (`main.css`, `main.js`).
- Sends messages to the UI (`loading`, `update`).
- Handles navigation messages from UI (`navigate`) to open source files at exact lines.

The browser side (`webview-ui/src/main.ts`):

- Receives tree payload, renders expandable router/procedure nodes.
- Supports search, expand/collapse all, copy schema, and code navigation.
- Displays input/output panels per procedure with light type formatting.

---

## Security in the webview

The webview is locked down with CSP:

- `default-src 'none'`
- scripts only via nonce
- styles only from `webview.cspSource`

---

## Build pipeline

- Extension host code is bundled with `esbuild` (`esbuild.js`) into `dist/extension.js`.
- Webview UI is built with Vite from `webview-ui` into `dist/webview`.
- `pnpm run watch` runs TypeScript checks + esbuild watch + webview watch.
- `pnpm run package` runs checks/lint/build and produces a production build.
