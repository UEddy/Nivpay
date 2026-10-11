import { test } from "node:test";
import assert from "node:assert/strict";
import { copy } from "../copy.ts";
import { recipientDetail } from "./recipient.ts";

const ID = "0xa5057F32DB2a6f68F69ad1587014AbF101A20B61";

test("a pasted Account ID says 'account ending' once, not twice (Send, footage 1000336013 at 25 s)", () => {
  assert.equal(recipientDetail({ account: ID, name: copy.accountEnding(ID) }), null);
});

test("a named recipient keeps the 'account ending' line under the name", () => {
  assert.equal(recipientDetail({ account: ID, name: "Maya" }), "account ending 0B61");
});
