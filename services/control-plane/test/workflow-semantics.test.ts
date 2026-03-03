import test from "node:test";
import assert from "node:assert/strict";

import { canTransition } from "../src/workflow/transitions";

test("workflow transitions allow QC review path", () => {
  assert.equal(canTransition("completed", "qc_pending"), true);
  assert.equal(canTransition("qc_pending", "qc_in_review"), true);
  assert.equal(canTransition("qc_in_review", "qc_approved"), true);
  assert.equal(canTransition("qc_in_review", "qc_rejected"), true);
  assert.equal(canTransition("qc_rejected", "needs_replay"), true);
});

test("workflow transitions block invalid QC jumps", () => {
  assert.equal(canTransition("pending", "qc_in_review"), false);
  assert.equal(canTransition("processing", "qc_approved"), false);
});
