import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createInitialDataWorkItems,
  filterAndSortDataWorkItems,
  moveDataWorkItem,
  nextDataWorkId,
} from "../lib/data-work-queue";

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
  });

  it("allocates the next readable ID independently for each work type", () => {
    const items = createInitialDataWorkItems(NOW);
    assert.equal(nextDataWorkId("request", items), "REQ-188");
    assert.equal(nextDataWorkId("ticket", items), "TKT-323");
    assert.equal(nextDataWorkId("bug", items), "BUG-095");
  });
});
