import assert from "node:assert/strict";
import test from "node:test";
import { appendPromptStyle, draftFromQuery, groupHistory } from "../app/ui/workspace-helpers";

test("history grouping uses local calendar dates and a fixed group order", () => {
  const now = new Date(2026, 8, 7, 12);
  const items = [
    { id: "old", updated_at: new Date(2026, 7, 30, 23).toISOString() },
    { id: "today", updated_at: new Date(2026, 8, 7, 1).toISOString() },
    { id: "yesterday", updated_at: new Date(2026, 8, 6, 23).toISOString() },
    { id: "week", updated_at: new Date(2026, 8, 2, 12).toISOString() },
    { id: "invalid", updated_at: "unavailable" },
  ];
  assert.deepEqual(groupHistory(items, now).map(({ bucket, items }) => [bucket, items.map(({ id }) => id)]), [
    ["today", ["today"]], ["yesterday", ["yesterday"]], ["week", ["week"]], ["older", ["old", "invalid"]],
  ]);
  assert.deepEqual(groupHistory([], now), []);
});

test("style insertion preserves a draft and prevents duplicate or oversized additions", () => {
  assert.equal(appendPromptStyle("A blue bicycle", "Soft studio lighting"), "A blue bicycle\nSoft studio lighting");
  assert.equal(appendPromptStyle("", "Soft studio lighting"), "Soft studio lighting");
  assert.equal(appendPromptStyle("A blue bicycle\nSoft studio lighting", "Soft studio lighting"), "A blue bicycle\nSoft studio lighting");
  assert.equal(appendPromptStyle("A blue bicycle", "Soft studio lighting", 20), "A blue bicycle");
});

test("query drafts stay text and are capped to the actual composer limit", () => {
  assert.equal(draftFromQuery(null, "text"), null);
  assert.equal(draftFromQuery("", "image"), "");
  assert.equal(draftFromQuery("<script>alert(1)</script>", "text"), "<script>alert(1)</script>");
  assert.equal(draftFromQuery("a".repeat(20000), "text")?.length, 16000);
  assert.equal(draftFromQuery("a".repeat(20000), "image")?.length, 5000);
});
