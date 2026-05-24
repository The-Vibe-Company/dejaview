export type JsonObject = Record<string, unknown>;

export type SourceIdentity = {
  kind: string;
  uri?: string;
  external_id?: string;
  fingerprint?: string;
  title?: string;
  metadata?: JsonObject;
};

export type ActionStatus = "success" | "partial" | "failed" | "skipped";

export type ActionRecord = {
  id: string;
  source_id: string;
  action: string;
  agent?: string;
  status: ActionStatus;
  summary?: string;
  details?: JsonObject;
  created_at: string;
  outcomes: OutcomeRecord[];
};

export type OutcomeRecord = {
  id: string;
  kind: string;
  ref: string;
  title?: string;
  metadata?: JsonObject;
  linked_at: string;
  action_id?: string;
};

export type SourceRecord = SourceIdentity & {
  id: string;
  created_at: string;
  updated_at: string;
  actions: ActionRecord[];
};

export type LedgerData = {
  version: 1;
  sources: Record<string, SourceRecord>;
};
