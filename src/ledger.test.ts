import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import { Ledger, stableSourceId } from "./ledger.js";

async function withLedger(fn: (ledger: Ledger) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "dejaview-test-"));
  try {
    await fn(new Ledger(join(dir, "sources.json")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("stableSourceId is deterministic for the same source locator", () => {
  const a = stableSourceId({ kind: "URL", uri: "https://example.com/A" });
  const b = stableSourceId({ kind: "url", uri: " https://example.com/A " });
  assert.equal(a, b);
  assert.match(a, /^url_[a-f0-9]{24}$/);
});

test("shouldProcess returns false after a successful matching action", async () => {
  await withLedger(async (ledger) => {
    const source = { kind: "email", external_id: "msg_123", title: "Customer question" };

    const before = await ledger.shouldProcess({ source, action: "summarize" });
    assert.equal(before.should_process, true);
    assert.equal(before.reason, "no_matching_action");

    const recorded = await ledger.recordAction({
      source,
      action: "summarize",
      agent: "test-agent",
      summary: "Created a support summary.",
      outcomes: [{ kind: "note", ref: "granite://note/customer-question" }],
    });
    assert.equal(recorded.action.status, "success");
    assert.equal(recorded.action.outcomes.length, 1);

    const after = await ledger.shouldProcess({ source, action: "summarize" });
    assert.equal(after.should_process, false);
    assert.equal(after.reason, "already_success");
  });
});

test("linkOutcome attaches to the latest action by default", async () => {
  await withLedger(async (ledger) => {
    const source = { kind: "document", fingerprint: "sha256:abc" };
    await ledger.recordAction({ source, action: "extract" });

    const linked = await ledger.linkOutcome({
      source,
      outcome: { kind: "json", ref: "file:///tmp/extract.json", title: "Extraction" },
    });

    assert.equal(linked.action?.outcomes.length, 1);
    assert.equal(linked.outcome.action_id, linked.action?.id);

    const history = await ledger.getHistory({ source });
    assert.equal(history.actions[0]?.outcomes[0]?.ref, "file:///tmp/extract.json");
  });
});
