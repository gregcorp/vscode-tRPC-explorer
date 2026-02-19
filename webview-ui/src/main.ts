import "./style.css";
import type { TrpcNodeData } from "./types";

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

let rootNodes: TrpcNodeData[] = [];
let isLoading = true;
const expandedNodeIds = new Set<string>();
let searchTerm = "";

const rootEl = document.getElementById("root")!;
const searchInput = document.getElementById("search") as HTMLInputElement;

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "loading") {
    isLoading = true;
    render();
    return;
  }

  if (msg.type === "update") {
    isLoading = false;
    rootNodes = Array.isArray(msg.data) ? msg.data : [];
    expandedNodeIds.clear();
    for (const rootNode of rootNodes) {
      expandedNodeIds.add(buildNodeId(rootNode, 0));
    }
    render();
  }
});

searchInput.addEventListener("input", () => {
  searchTerm = searchInput.value.toLowerCase();
  render();
});

document.getElementById("collapse-all")!.addEventListener("click", () => {
  expandedNodeIds.clear();
  render();
});

document.getElementById("expand-all")!.addEventListener("click", () => {
  for (const rootNode of rootNodes) {
    expandAll(rootNode, 0);
  }
  render();
});

document.getElementById("refresh-btn")!.addEventListener("click", () => {
  isLoading = true;
  rootNodes = [];
  render();
  vscode.postMessage({ type: "ready" });
});

function expandAll(node: TrpcNodeData, depth: number): void {
  expandedNodeIds.add(buildNodeId(node, depth));
  if (node.type === "router") {
    for (const child of node.children) {
      expandAll(child, depth + 1);
    }
  }
}

function render(): void {
  if (isLoading) {
    rootEl.innerHTML = loadingStateHtml();
    return;
  }

  if (!rootNodes.length) {
    rootEl.innerHTML = emptyStateHtml();
    return;
  }

  const roots = rootNodes.map((node) => renderNode(node, 0)).join("");
  rootEl.innerHTML = `<div class="tree">${roots}</div>`;
  bindEvents();
}

function loadingStateHtml(): string {
  return `<div class="empty-state">
    <div class="loading-spinner"></div>
    <p>Loading…</p>
  </div>`;
}

function emptyStateHtml(): string {
  return `<div class="empty-state">
    <p>No AppRouter found.</p>
    <p style="font-size:11px;opacity:.7">To make it discoverable, export this in your server router file:</p>
    <p style="font-size:11px;opacity:.85"><code>export type AppRouter = typeof appRouter</code></p>
    <p style="font-size:11px;opacity:.7">Then click refresh.</p>
  </div>`;
}

function renderNode(node: TrpcNodeData, depth: number): string {
  const isRouter = node.type === "router";
  const isProcedure = !isRouter;
  const id = buildNodeId(node, depth);
  const isOpen = expandedNodeIds.has(id);
  const displayInput = node.prettyInput?.trim()
    ? node.prettyInput
    : node.inputSchema;
  const displayOutput = node.prettyOutput?.trim()
    ? node.prettyOutput
    : node.outputSchema;

  if (searchTerm && !matchesSearch(node)) {
    return "";
  }

  const childrenHtml = isRouter
    ? node.children.map((c) => renderNode(c, depth + 1)).join("")
    : "";
  const hasVisibleChildren = isRouter && childrenHtml.length > 0;

  const hasDetails = isProcedure;
  const isCollapsible = isRouter || hasDetails;

  const chevronCls = isCollapsible
    ? `chevron${isOpen ? " open" : ""}`
    : "chevron hidden";

  let rightSide = "";
  if (isRouter) {
    const counts = countProcedures(node);
    const parts: string[] = [];
    if (counts.query) {
      parts.push(`<span class="counter q">${counts.query}Q</span>`);
    }
    if (counts.mutation) {
      parts.push(`<span class="counter m">${counts.mutation}M</span>`);
    }
    if (counts.subscription) {
      parts.push(`<span class="counter s">${counts.subscription}S</span>`);
    }
    if (parts.length) {
      rightSide = `<span class="counters">${parts.join("")}</span>`;
    }
  } else {
    const codeButton = node.filePath
      ? `<button class="code-nav-btn" type="button" title="Open code" data-file="${escapeAttr(node.filePath)}" data-line="${node.line ?? 1}">↗</button>`
      : "";
    rightSide = `<span class="node-actions"><span class="badge ${node.type}">${node.type}</span>${codeButton}</span>`;
  }

  const nameHtml = searchTerm
    ? highlightText(node.name, searchTerm)
    : escapeHtml(node.name);

  const fileAttr = node.filePath
    ? ` data-file="${escapeAttr(node.filePath)}" data-line="${node.line ?? 1}"`
    : "";

  let html = `<div class="node" style="--depth:${depth}">`;
  html += `<div class="node-header${isProcedure ? " procedure-header" : ""}" data-id="${escapeAttr(id)}"${fileAttr}>`;
  html += `<span class="${chevronCls}"><svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4z"/></svg></span>`;
  if (isRouter) {
    html += `<span class="type-icon router"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-10L14.5 3zm-.51 8.49V13h-12V7h4.49l.35-.15.86-.86H14v5.5zM6.51 3l.85.85.36.15H14v2H7.71l-.85.85-.36.15H2V3h4.51z"/></svg></span>`;
  }
  html += `<span class="node-name${isRouter ? " router-name" : ` ${node.type}-name`}">${nameHtml}</span>`;
  html += rightSide;
  html += `</div>`;

  if (isProcedure && hasDetails) {
    const inputFallback = missingSchemaPlaceholder(displayInput);
    const outputFallback = missingSchemaPlaceholder(displayOutput);

    const rawInput = displayInput ?? inputFallback;
    const rawOutput = displayOutput ?? outputFallback;

    html += `<div class="node-children proc-details${isOpen ? "" : " collapsed"}">`;
    html += `<div class="schema-block" style="--depth:${depth}">`;
    html += `<div class="schema-header">`;
    html += `<span class="schema-label">input</span>`;
    html += `<button class="copy-btn" type="button" title="Copy" data-copy="${escapeAttr(rawInput)}">${copyIcon}</button>`;
    html += `</div>`;
    html += `<div class="schema-body">${formatPrettySchema(rawInput)}</div>`;
    html += `</div>`;

    html += `<div class="schema-block" style="--depth:${depth}">`;
    html += `<div class="schema-header">`;
    html += `<span class="schema-label">output</span>`;
    html += `<button class="copy-btn" type="button" title="Copy" data-copy="${escapeAttr(rawOutput)}">${copyIcon}</button>`;
    html += `</div>`;
    html += `<div class="schema-body">${formatPrettySchema(rawOutput)}</div>`;
    html += `</div>`;

    html += `</div>`;
  }

  if (isRouter && hasVisibleChildren) {
    html += `<div class="node-children${isOpen ? "" : " collapsed"}">`;
    html += childrenHtml;
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

const copyIcon = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 4h3v1H4v8h6v-2h1v2.5l-.5.5h-7l-.5-.5v-9l.5-.5z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M7 1.5l.5-.5h7l.5.5v9l-.5.5h-7l-.5-.5v-9zM8 2v8h6V2H8z"/></svg>`;

const checkIcon = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>`;

function prettyPrintTypeString(input: string): string {
  //pretty raw "json's" types
  if (!input.includes("{")) {
    return input;
  }

  const normalizedInput = collapseWhitespaceOutsideStrings(input);

  let result = "";
  let indent = 0;
  const TAB = "  ";
  let i = 0;

  while (i < normalizedInput.length) {
    const ch = normalizedInput[i];

    // String literals – pass through untouched
    if (ch === '"' || ch === "'") {
      const quote = ch;
      result += ch;
      i++;
      while (i < normalizedInput.length && normalizedInput[i] !== quote) {
        result += normalizedInput[i];
        i++;
      }
      if (i < normalizedInput.length) {
        result += normalizedInput[i];
        i++;
      }
    } else if (ch === "{") {
      indent++;
      result += "{\n" + TAB.repeat(indent);
      i++;
      while (i < normalizedInput.length && normalizedInput[i] === " ") {
        i++;
      }
    } else if (ch === "}") {
      indent--;
      result += "\n" + TAB.repeat(indent) + "}";
      i++;
    } else if (ch === ";") {
      result += ";";
      i++;
      while (i < normalizedInput.length && normalizedInput[i] === " ") {
        i++;
      }
      if (i < normalizedInput.length && normalizedInput[i] !== "}") {
        result += "\n" + TAB.repeat(indent);
      }
    } else {
      result += ch;
      i++;
    }
  }

  return result.replace(/\n{2,}/g, "\n").trim();
}

function collapseWhitespaceOutsideStrings(input: string): string {
  let output = "";
  let inString: '"' | "'" | "`" | null = null;
  let previousWasWhitespace = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inString) {
      output += ch;
      if (ch === "\\") {
        i++;
        if (i < input.length) {
          output += input[i];
        }
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      previousWasWhitespace = false;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      output += ch;
      previousWasWhitespace = false;
      continue;
    }

    if (/\s/.test(ch)) {
      if (!previousWasWhitespace) {
        output += " ";
        previousWasWhitespace = true;
      }
      continue;
    }

    output += ch;
    previousWasWhitespace = false;
  }

  return output.trim();
}

function formatPrettySchema(schema: string): string {
  const formatted = prettyPrintTypeString(schema);
  const stringPlaceholders: string[] = [];

  const withPlaceholders = escapeHtml(formatted).replace(
    /&quot;[\s\S]*?&quot;/g,
    (literal) => {
      const placeholder = `__SCHEMA_STRING_${stringPlaceholders.length}__`;
      stringPlaceholders.push(`<span class="schema-string">${literal}</span>`);
      return placeholder;
    },
  );

  const highlighted = withPlaceholders
    .replace(
      /(\w+)\s*:/g,
      '<span class="schema-key">$1</span><span class="schema-punctuation">:</span>',
    )
    .replace(
      /\b(string|number|boolean|Date|bigint|void|null|undefined|unknown|any|never)\b/g,
      '<span class="schema-type">$1</span>',
    )
    .replace(/(\?)/g, '<span class="schema-optional">?</span>');

  return highlighted.replace(/__SCHEMA_STRING_(\d+)__/g, (_, index) => {
    return stringPlaceholders[Number(index)] ?? "";
  });
}

function bindEvents(): void {
  document
    .querySelectorAll<HTMLButtonElement>(".code-nav-btn")
    .forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const filePath = button.getAttribute("data-file");
        const line = parseInt(button.getAttribute("data-line") ?? "1", 10);
        if (filePath) {
          vscode.postMessage({ type: "navigate", filePath, line });
        }
      });
    });

  document.querySelectorAll<HTMLButtonElement>(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const text = btn.getAttribute("data-copy") ?? "";
      navigator.clipboard.writeText(text).then(() => {
        btn.innerHTML = checkIcon;
        btn.classList.add("copied");
        setTimeout(() => {
          btn.innerHTML = copyIcon;
          btn.classList.remove("copied");
        }, 1500);
      });
    });
  });

  document.querySelectorAll<HTMLElement>(".node-header").forEach((header) => {
    header.addEventListener("click", () => {
      const id = header.getAttribute("data-id");
      if (!id) {
        return;
      }

      let el = header.nextElementSibling;
      while (el && !el.classList.contains("node-children")) {
        el = el.nextElementSibling;
      }

      if (el?.classList.contains("node-children")) {
        if (expandedNodeIds.has(id)) {
          expandedNodeIds.delete(id);
        } else {
          expandedNodeIds.add(id);
        }
        render();
      }
    });

    header.addEventListener("dblclick", () => {
      const filePath = header.getAttribute("data-file");
      const line = parseInt(header.getAttribute("data-line") ?? "1", 10);
      if (filePath) {
        vscode.postMessage({ type: "navigate", filePath, line });
      }
    });
  });
}

function buildNodeId(node: TrpcNodeData, depth: number): string {
  return `${depth}:${node.filePath ?? ""}:${node.name}`;
}

function matchesSearch(node: TrpcNodeData): boolean {
  const displayInput = node.prettyInput?.trim()
    ? node.prettyInput
    : node.inputSchema;
  const displayOutput = node.prettyOutput?.trim()
    ? node.prettyOutput
    : node.outputSchema;

  if (node.name.toLowerCase().includes(searchTerm)) {
    return true;
  }
  if (node.type.toLowerCase().includes(searchTerm)) {
    return true;
  }
  if (displayInput?.toLowerCase().includes(searchTerm)) {
    return true;
  }
  if (displayOutput?.toLowerCase().includes(searchTerm)) {
    return true;
  }
  if (node.children) {
    return node.children.some((c) => matchesSearch(c));
  }
  return false;
}

function countProcedures(node: TrpcNodeData): Record<string, number> {
  const counts: Record<string, number> = {
    query: 0,
    mutation: 0,
    subscription: 0,
  };
  for (const child of node.children ?? []) {
    if (child.type === "router") {
      const sub = countProcedures(child);
      counts.query += sub.query;
      counts.mutation += sub.mutation;
      counts.subscription += sub.subscription;
    } else {
      counts[child.type] = (counts[child.type] || 0) + 1;
    }
  }
  return counts;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function missingSchemaPlaceholder(schema: string | undefined): string {
  if (!schema) {
    return "undefined";
  }
  return /\bnull\b/i.test(schema) ? "null" : "undefined";
}

function highlightText(text: string, term: string): string {
  const idx = text.toLowerCase().indexOf(term);
  if (idx === -1) {
    return escapeHtml(text);
  }
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + term.length);
  const after = text.slice(idx + term.length);
  return `${escapeHtml(before)}<span class="highlight">${escapeHtml(match)}</span>${escapeHtml(after)}`;
}

vscode.postMessage({ type: "ready" });
