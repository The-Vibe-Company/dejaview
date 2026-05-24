import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { ActionRecord, ActionStatus, JsonObject, LedgerData, OutcomeRecord, SourceIdentity, SourceRecord } from "./types.js";

const LEDGER_FILE = "sources.json";

export function getDefaultHome(): string {
  return process.env.DEJAVIEW_HOME ?? join(homedir(), ".dejaview");
}

export function getDefaultStorePath(): string {
  return join(getDefaultHome(), LEDGER_FILE);
}

export function stableSourceId(source: SourceIdentity): string {
  const kind = normalize(source.kind);
  const locator = source.fingerprint ?? source.uri ?? source.external_id ?? source.title;
  if (!locator) {
    throw new Error("A source needs at least one locator: fingerprint, uri, external_id, or title.");
  }
  const hash = createHash("sha256")
    .update(`${kind}:${normalize(locator)}`)
    .digest("hex")
    .slice(0, 24);
  return `${kind}_${hash}`;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function now(): string {
  return new Date().toISOString();
}

async function readJsonFile(path: string): Promise<LedgerData> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as LedgerData;
    if (parsed.version !== 1 || typeof parsed.sources !== "object") {
      throw new Error(`Unsupported ledger format in ${path}`);
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, sources: {} };
    }
    throw error;
  }
}

async function writeJsonFile(path: string, data: LedgerData): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export class Ledger {
  constructor(public readonly path = getDefaultStorePath()) {}

  async read(): Promise<LedgerData> {
    return readJsonFile(this.path);
  }

  async resolveSource(source: SourceIdentity): Promise<{ source: SourceRecord; created: boolean }> {
    const data = await this.read();
    const id = stableSourceId(source);
    const existing = data.sources[id];
    const timestamp = now();

    if (existing) {
      const merged: SourceRecord = {
        ...existing,
        ...dropUndefined(source),
        id,
        kind: source.kind,
        metadata: { ...(existing.metadata ?? {}), ...(source.metadata ?? {}) },
        updated_at: timestamp,
        actions: existing.actions,
      };
      data.sources[id] = merged;
      await writeJsonFile(this.path, data);
      return { source: merged, created: false };
    }

    const record: SourceRecord = {
      ...source,
      id,
      created_at: timestamp,
      updated_at: timestamp,
      actions: [],
    };
    data.sources[id] = record;
    await writeJsonFile(this.path, data);
    return { source: record, created: true };
  }

  async shouldProcess(input: {
    source: SourceIdentity;
    action?: string;
    agent?: string;
    reprocess_failed?: boolean;
  }): Promise<{ should_process: boolean; reason: string; source: SourceRecord; last_action?: ActionRecord }> {
    const { source } = await this.resolveSource(input.source);
    const matching = [...source.actions]
      .reverse()
      .find((action) => (!input.action || action.action === input.action) && (!input.agent || action.agent === input.agent));

    if (!matching) {
      return { should_process: true, reason: "no_matching_action", source };
    }

    if (matching.status === "success" || matching.status === "partial" || matching.status === "skipped") {
      return { should_process: false, reason: `already_${matching.status}`, source, last_action: matching };
    }

    if (matching.status === "failed" && input.reprocess_failed !== false) {
      return { should_process: true, reason: "last_matching_action_failed", source, last_action: matching };
    }

    return { should_process: false, reason: "last_matching_action_failed_reprocess_disabled", source, last_action: matching };
  }

  async recordAction(input: {
    source: SourceIdentity;
    action: string;
    agent?: string;
    status?: ActionStatus;
    summary?: string;
    details?: JsonObject;
    outcomes?: Array<Omit<OutcomeRecord, "id" | "linked_at" | "action_id"> & { id?: string }>;
  }): Promise<{ source: SourceRecord; action: ActionRecord }> {
    const data = await this.read();
    const id = stableSourceId(input.source);
    const timestamp = now();
    const existing = data.sources[id];
    const source: SourceRecord = existing ?? {
      ...input.source,
      id,
      created_at: timestamp,
      updated_at: timestamp,
      actions: [],
    };

    const action: ActionRecord = {
      id: randomUUID(),
      source_id: id,
      action: input.action,
      agent: input.agent,
      status: input.status ?? "success",
      summary: input.summary,
      details: input.details,
      created_at: timestamp,
      outcomes: (input.outcomes ?? []).map((outcome) => ({
        id: outcome.id ?? randomUUID(),
        kind: outcome.kind,
        ref: outcome.ref,
        title: outcome.title,
        metadata: outcome.metadata,
        linked_at: timestamp,
        action_id: undefined,
      })),
    };
    action.outcomes = action.outcomes.map((outcome) => ({ ...outcome, action_id: action.id }));

    source.actions.push(action);
    source.updated_at = timestamp;
    data.sources[id] = source;
    await writeJsonFile(this.path, data);
    return { source, action };
  }

  async getHistory(input: { source: SourceIdentity; limit?: number }): Promise<{ source?: SourceRecord; actions: ActionRecord[] }> {
    const data = await this.read();
    const id = stableSourceId(input.source);
    const source = data.sources[id];
    if (!source) return { actions: [] };
    const actions = [...source.actions].reverse().slice(0, input.limit ?? 20);
    return { source, actions };
  }

  async linkOutcome(input: {
    source: SourceIdentity;
    action_id?: string;
    outcome: Omit<OutcomeRecord, "id" | "linked_at" | "action_id"> & { id?: string };
  }): Promise<{ source: SourceRecord; outcome: OutcomeRecord; action?: ActionRecord }> {
    const data = await this.read();
    const id = stableSourceId(input.source);
    const timestamp = now();
    const source = data.sources[id];
    if (!source) {
      throw new Error("Cannot link an outcome to an unknown source. Call resolve_source or record_action first.");
    }

    const action = input.action_id
      ? source.actions.find((candidate) => candidate.id === input.action_id)
      : source.actions.at(-1);
    if (!action) {
      throw new Error("Cannot link an outcome because the source has no matching action.");
    }

    const outcome: OutcomeRecord = {
      id: input.outcome.id ?? randomUUID(),
      kind: input.outcome.kind,
      ref: input.outcome.ref,
      title: input.outcome.title,
      metadata: input.outcome.metadata,
      linked_at: timestamp,
      action_id: action.id,
    };
    action.outcomes.push(outcome);
    source.updated_at = timestamp;
    data.sources[id] = source;
    await writeJsonFile(this.path, data);
    return { source, action, outcome };
  }
}

function dropUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}
