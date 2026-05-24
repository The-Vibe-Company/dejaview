# DéjàView

**DéjàView is a local-first action ledger for agent source processing.**

It answers one deceptively important question for agents:

> “Have I already processed this source — and if yes, what did I do with it?”

DéjàView is an MCP server and npm package that lets agents resolve arbitrary sources, decide whether they should process them, record high-level actions, and link produced outcomes. It is intentionally small, local, and opinionated: not a generic CRUD database, but business logic for source provenance.

## Why

Agents repeatedly touch the same inputs: emails, URLs, PDFs, meeting transcripts, Notion pages, GitHub issues, support tickets, rows in a CRM, local files, audio recordings, and source kinds nobody has named yet.

Without a ledger, they either:

- reprocess the same source again and again,
- forget which artifact came from which source,
- overwrite or duplicate outcomes,
- rely on fragile app-specific state,
- or ask humans questions they could answer locally.

DéjàView gives agents a simple memory layer for source-level provenance.

## The concept

DéjàView has three core objects:

- **Source**: anything an agent can process. A source has a `kind` plus at least one stable locator: `uri`, `external_id`, `fingerprint`, or `title`.
- **Action**: what an agent did to a source: `summarize`, `ingest`, `extract_entities`, `classify`, `reply`, `index`, etc.
- **Outcome**: the artifact produced by an action: a note slug, file path, URL, task ID, vector index reference, email draft ID, database row, etc.

Example ledger entry, conceptually:

```json
{
  "source": {
    "kind": "url",
    "uri": "https://example.com/research"
  },
  "action": "summarize",
  "agent": "research-agent",
  "status": "success",
  "outcomes": [
    {
      "kind": "note",
      "ref": "granite://note/example-research-summary"
    }
  ]
}
```

## Relationship to Granite

Granite is a second brain / knowledge layer: it captures notes, sources, syntheses, people, organizations, meetings, and graph context.

DéjàView is the provenance ledger underneath agent workflows: it tracks source-processing decisions and outcomes across any system.

In short:

- **Granite**: “What do we know?”
- **DéjàView**: “Did an agent already process this source, and what happened?”

They are complementary. A DéjàView outcome can point to a Granite note, but it can just as easily point to a file, ticket, email draft, vector index, or external URL.

## Install

```bash
npm install -g dejaview
```

Run the MCP server over stdio:

```bash
dejaview
```

The package stores its local ledger at:

```text
~/.dejaview/sources.json
```

Override the home directory with:

```bash
DEJAVIEW_HOME=/path/to/dejaview-home dejaview
```

## MCP configuration

Add DéjàView to an MCP client config:

```json
{
  "mcpServers": {
    "dejaview": {
      "command": "dejaview"
    }
  }
}
```

With a custom ledger location:

```json
{
  "mcpServers": {
    "dejaview": {
      "command": "dejaview",
      "env": {
        "DEJAVIEW_HOME": "/Users/you/.dejaview-work"
      }
    }
  }
}
```

For local development from this repository:

```json
{
  "mcpServers": {
    "dejaview": {
      "command": "node",
      "args": ["/absolute/path/to/dejaview/dist/index.js"]
    }
  }
}
```

## Tools

DéjàView exposes high-level MCP tools. The tools are designed around workflow decisions, not low-level table operations.

### `resolve_source`

Resolve a source to a stable local record, creating it if needed.

Input:

```json
{
  "source": {
    "kind": "email",
    "external_id": "msg_abc123",
    "title": "Customer request"
  }
}
```

Use this when an agent has encountered a source and wants a canonical DéjàView ID.

### `should_process`

Decide whether a source should be processed for a specific action.

Input:

```json
{
  "source": {
    "kind": "url",
    "uri": "https://example.com/post"
  },
  "action": "summarize",
  "agent": "research-agent"
}
```

Returns `should_process: false` when a successful, partial, or skipped matching action already exists. Failed actions are retried by default unless `reprocess_failed` is set to `false`.

### `record_action`

Append a new action to a source, creating the source if needed.

Input:

```json
{
  "source": {
    "kind": "document",
    "fingerprint": "sha256:...",
    "title": "Vendor contract"
  },
  "action": "extract_obligations",
  "agent": "contracts-agent",
  "status": "success",
  "summary": "Extracted renewal and termination obligations.",
  "outcomes": [
    {
      "kind": "markdown",
      "ref": "file:///Users/you/notes/vendor-contract-obligations.md"
    }
  ]
}
```

### `get_history`

Return recent processing history for a source, newest action first.

Input:

```json
{
  "source": {
    "kind": "notion_page",
    "external_id": "page_123"
  },
  "limit": 10
}
```

### `link_outcome`

Attach a produced artifact to a prior action for a source. If no `action_id` is provided, DéjàView links to the latest action for that source.

Input:

```json
{
  "source": {
    "kind": "ticket",
    "external_id": "SUP-42"
  },
  "outcome": {
    "kind": "task",
    "ref": "linear://TVC-123",
    "title": "Follow up with customer"
  }
}
```

## Source identity

A source is intentionally flexible:

```ts
type Source = {
  kind: string;
  uri?: string;
  external_id?: string;
  fingerprint?: string;
  title?: string;
  metadata?: Record<string, unknown>;
};
```

DéjàView derives a stable source ID from:

1. `kind`, and
2. the first available locator in this order: `fingerprint`, `uri`, `external_id`, `title`.

Use `fingerprint` for content-addressed dedupe, `uri` for web/local resources, `external_id` for app-native IDs, and `title` only as a fallback.

## Storage

MVP storage is a single local JSON file:

```text
~/.dejaview/sources.json
```

This keeps DéjàView easy to inspect, back up, sync, or delete. The JSON backend is intentionally boring for the first release; future versions may add SQLite while keeping the same tool semantics.

## Development

```bash
npm install
npm test
npm run build
```

## Releases

DéjàView uses Release Please, like Granite-style infrastructure: humans and agents land conventional commits on `main`, Release Please opens or updates a release PR, and merging that PR creates the GitHub release and publishes the package to npm.

Required repository secret:

```text
NPM_TOKEN
```

Release flow:

1. Commit with Conventional Commits, e.g. `feat: add source aliases` or `fix: retry failed actions`.
2. The `Release Please` workflow opens/updates the release PR.
3. Merge the release PR.
4. GitHub Actions runs tests and publishes to npm with provenance.

## MVP status

DéjàView is early and intentionally minimal. Current scope:

- local JSON storage,
- MCP stdio server,
- stable source resolution,
- process/no-process decisions,
- append-only action history,
- outcome linking,
- TypeScript types and basic tests.

Not included yet:

- multi-writer locking,
- remote sync,
- migrations beyond the initial JSON shape,
- encryption,
- a standalone non-MCP CLI UI,
- source-specific connectors.

## License

MIT
