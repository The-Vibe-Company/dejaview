#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Ledger } from "./ledger.js";

const jsonObject = z.record(z.unknown());

const sourceSchema = z.object({
  kind: z.string().min(1).describe("Arbitrary source kind, e.g. email, url, document, notion_page, ticket."),
  uri: z.string().optional().describe("Canonical URI or URL when available."),
  external_id: z.string().optional().describe("External system identifier when available."),
  fingerprint: z.string().optional().describe("Stable content hash or caller-provided dedupe key."),
  title: z.string().optional().describe("Human-readable title."),
  metadata: jsonObject.optional().describe("Source-specific metadata."),
});

const outcomeSchema = z.object({
  id: z.string().optional(),
  kind: z.string().min(1).describe("Outcome kind, e.g. note, summary, task, vector_index, email_reply."),
  ref: z.string().min(1).describe("Reference to the produced artifact: path, URL, slug, ID, etc."),
  title: z.string().optional(),
  metadata: jsonObject.optional(),
});

const statusSchema = z.enum(["success", "partial", "failed", "skipped"]);

const ledger = new Ledger();
const server = new McpServer({
  name: "dejaview",
  version: "0.1.0",
});

function asText(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

server.tool(
  "resolve_source",
  "Resolve an arbitrary source to DéjàView's stable local source record, creating it if needed.",
  { source: sourceSchema },
  async ({ source }) => asText(await ledger.resolveSource(source)),
);

server.tool(
  "should_process",
  "Decide whether an agent should process a source for a given action, using the ledger's prior actions.",
  {
    source: sourceSchema,
    action: z.string().optional().describe("Specific action to check, e.g. summarize, ingest, extract_entities."),
    agent: z.string().optional().describe("Optional agent name to scope the check."),
    reprocess_failed: z.boolean().default(true).describe("Whether failed prior attempts should be retried."),
  },
  async (input) => asText(await ledger.shouldProcess(input)),
);

server.tool(
  "record_action",
  "Record what an agent did with a source. Creates the source if needed and appends an immutable action entry.",
  {
    source: sourceSchema,
    action: z.string().min(1),
    agent: z.string().optional(),
    status: statusSchema.default("success"),
    summary: z.string().optional(),
    details: jsonObject.optional(),
    outcomes: z.array(outcomeSchema).default([]),
  },
  async (input) => asText(await ledger.recordAction(input)),
);

server.tool(
  "get_history",
  "Return the recent processing history for a source, newest action first.",
  {
    source: sourceSchema,
    limit: z.number().int().positive().max(100).default(20),
  },
  async (input) => asText(await ledger.getHistory(input)),
);

server.tool(
  "link_outcome",
  "Attach a produced artifact to a prior action for a source. Defaults to the latest action.",
  {
    source: sourceSchema,
    action_id: z.string().optional(),
    outcome: outcomeSchema,
  },
  async (input) => asText(await ledger.linkOutcome(input)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
