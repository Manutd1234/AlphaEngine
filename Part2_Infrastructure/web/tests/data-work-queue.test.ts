import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createInitialDataWorkItems,
  filterAndSortDataWorkItems,
  moveDataWorkItem,
  nextDataWorkId,
} from "../lib/data-work-queue";
import {
  createInitialDeveloperWorkItems,
  filterDeveloperWorkItems,
  moveDeveloperWorkItem,
  nextDeveloperWorkId,
} from "../lib/developer-work";

const NOW = Date.UTC(2026, 7, 5, 12);

describe("the data operations work queue", () => {
  it("filters across operational fields and keeps priority ordering deterministic", () => {
    const items = createInitialDataWorkItems(NOW);
    const bugs = filterAndSortDataWorkItems(items, {
      query: "market data",
      kind: "bug",
      sort: "priority",
    });
    assert.deepEqual(bugs.map((item) => item.id), ["BUG-091"]);

    const priority = filterAndSortDataWorkItems(items, {
      query: "",
      kind: "all",
      sort: "priority",
    });
    assert.equal(priority[0].priority, "P0");
    assert.ok(priority.findIndex((item) => item.priority === "P1") < priority.findIndex((item) => item.priority === "P2"));

    const developerItems = createInitialDeveloperWorkItems(NOW);
    const contractFeatures = filterDeveloperWorkItems(developerItems, {
      query: "contracts",
      kind: "feature",
      status: "all",
    });
    assert.deepEqual(contractFeatures.map((item) => item.id), ["FEAT-074"]);
  });

  it("moves only the selected item without mutating or losing queue records", () => {
    const source = createInitialDataWorkItems(NOW);
    const before = source.find((item) => item.id === "REQ-184")!;
    const moved = moveDataWorkItem(source, "REQ-184", "progress");

    assert.equal(before.status, "intake");
    assert.equal(moved.find((item) => item.id === "REQ-184")?.status, "progress");
    assert.equal(moved.length, source.length);
    assert.deepEqual(new Set(moved.map((item) => item.id)), new Set(source.map((item) => item.id)));

    const unknown = moveDataWorkItem(source, "BUG-999", "resolved");
    assert.deepEqual(unknown, source);

    const developerSource = createInitialDeveloperWorkItems(NOW);
    const developerMoved = moveDeveloperWorkItem(developerSource, "BUG-204", "review");
    assert.equal(developerSource.find((item) => item.id === "BUG-204")?.status, "done");
    assert.equal(developerMoved.find((item) => item.id === "BUG-204")?.status, "review");
    assert.equal(developerMoved.length, developerSource.length);
  });

  it("allocates the next readable ID independently for each work type", () => {
    const items = createInitialDataWorkItems(NOW);
    assert.equal(nextDataWorkId("request", items), "REQ-188");
    assert.equal(nextDataWorkId("ticket", items), "TKT-323");
    assert.equal(nextDataWorkId("bug", items), "BUG-095");

    const developerItems = createInitialDeveloperWorkItems(NOW);
    assert.equal(nextDeveloperWorkId("feature", developerItems), "FEAT-078");
    assert.equal(nextDeveloperWorkId("bug", developerItems), "BUG-205");
    assert.equal(nextDeveloperWorkId("ticket", developerItems), "TKT-414");
  });
});

describe("the persisted queue's wire mapping and merge", () => {
  it("maps a gateway row into the board's item and keeps the version", async () => {
    const { fromWire, isDataWorkItemWire, upsertDataWorkItem } = await import("../lib/data-work-queue");
    const wire = {
      id: "BUG-101", kind: "bug", priority: "P1", status: "ready", title: "t", summary: "s", owner: "Mei", area: "Pipeline",
      opened_at: NOW, sla_due_at: NOW + 3_600_000, resolved_at: null, created_by: "seed", updated_at: NOW, updated_by: "seed", version: 3,
    };
    assert.equal(isDataWorkItemWire(wire), true);
    assert.equal(isDataWorkItemWire({ ...wire, kind: "epic" }), false);
    assert.equal(isDataWorkItemWire({ ...wire, version: "3" }), false);
    const item = fromWire(wire as never);
    assert.equal(item.openedAt, NOW);
    assert.equal(item.slaDueAt, NOW + 3_600_000);
    assert.equal(item.version, 3);
    assert.equal(item.createdBy, "seed");
    // Upsert replaces in place, or prepends a row the list has never seen.
    const list = createInitialDataWorkItems(NOW);
    const replaced = upsertDataWorkItem(list, { ...list[2], status: "resolved", version: 2 });
    assert.equal(replaced[2].status, "resolved");
    assert.equal(replaced.length, list.length);
    const added = upsertDataWorkItem(list, item);
    assert.equal(added[0].id, "BUG-101");
    assert.equal(added.length, list.length + 1);
  });

  it("the seeds mirror the gateway's: nine rows, marked as seeds, at version 1", () => {
    const items = createInitialDataWorkItems(NOW);
    assert.equal(items.length, 9);
    assert.ok(items.every((i) => i.version === 1 && i.createdBy === "seed"));
    assert.deepEqual(items.map((i) => i.id), ["BUG-091", "BUG-094", "TKT-322", "REQ-184", "REQ-187", "TKT-319", "REQ-179", "TKT-311", "BUG-088"]);
  });
});
