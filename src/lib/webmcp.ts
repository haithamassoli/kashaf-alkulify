/**
 * WebMCP: exposes the archive search as a tool a browser AI agent can call
 * (https://github.com/webmachinelearning/webmcp). A no-op where unsupported.
 */
import { articlePath, lessonPath } from "./paths";
import { SEARCH_ENDPOINT } from "./search-api";

interface ToolResult {
  content: { text: string; type: "text" }[];
}

interface Tool {
  annotations: { readOnlyHint: boolean };
  description: string;
  execute: (input: Record<string, unknown>) => Promise<ToolResult>;
  inputSchema: Record<string, unknown>;
  name: string;
}

interface ModelContext {
  registerTool: (tool: Tool) => unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isModelContext = (value: unknown): value is ModelContext =>
  isRecord(value) && typeof value.registerTool === "function";

const text = (value: unknown): ToolResult => ({
  content: [{ text: JSON.stringify(value), type: "text" }],
});

const link = (scope: string, hit: Record<string, unknown>): string => {
  const id = String(hit.sourceId);

  if (scope === "articles") {
    return new URL(articlePath(id), location.origin).href;
  }
  const url = new URL(lessonPath(id), location.origin);

  if (typeof hit.startMs === "number") {
    url.searchParams.set("t", String(Math.floor(hit.startMs / 1000)));
  }
  return url.href;
};

const search = async (input: Record<string, unknown>): Promise<ToolResult> => {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  const scope = input.scope === "articles" ? "articles" : "audio";

  if (!query) {
    return text({ error: "query is required" });
  }

  const response = await fetch(`${SEARCH_ENDPOINT}/search`, {
    body: JSON.stringify({
      mode: input.exact === true ? "phrase" : "hybrid",
      query: query.slice(0, 500),
      scope,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(180_000),
  });
  const result: unknown = await response.json();

  if (!(response.ok && isRecord(result) && Array.isArray(result.hits))) {
    return text({ error: "Search is unavailable; retry shortly." });
  }

  return text({
    // Mirrors the site's own notices so an agent does not overstate coverage.
    closestOnly: result.widened === true,
    hits: result.hits.filter(isRecord).map((hit) => ({
      context: hit.context,
      excerpt: hit.text,
      source: hit.url || undefined,
      title: hit.title,
      url: link(scope, hit),
    })),
    incomplete: Array.isArray(result.degraded) && result.degraded.length > 0,
    sampleOnly: result.candidateLimitReached === true,
  });
};

export const registerTools = (): void => {
  const context: unknown =
    Reflect.get(document, "modelContext") ??
    Reflect.get(navigator, "modelContext");

  if (!isModelContext(context)) {
    return;
  }

  context.registerTool({
    annotations: { readOnlyHint: true },
    description:
      "Search the transcribed audio lessons or the articles of Sheikh Abu Jafar Abdullah bin Fahd Al-Khulaifi. Returns his original words as excerpts with surrounding context and a link to the exact moment or article. Queries are Arabic. Quote excerpts as they are and read the context before attributing a view to him.",
    execute: search,
    inputSchema: {
      properties: {
        exact: {
          description:
            "true to match the exact wording of a remembered phrase; false (default) to search by topic.",
          type: "boolean",
        },
        query: {
          description: "Arabic words or a phrase to look for.",
          maxLength: 500,
          type: "string",
        },
        scope: {
          description: "audio lessons (default) or articles.",
          enum: ["audio", "articles"],
          type: "string",
        },
      },
      required: ["query"],
      type: "object",
    },
    name: "search_sheikh_archive",
  });
};
