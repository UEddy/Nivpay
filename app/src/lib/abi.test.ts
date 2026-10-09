import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { formatAbiItem } from "viem/utils";
import type { Abi, AbiEvent, AbiFunction, AbiParameter } from "viem";
import { POTS_ABI } from "./abi.ts";

const BUILD = new URL("../../../out/NivPayPots.sol/NivPayPots.json", import.meta.url);

type Item = Extract<Abi[number], { type: "function" | "event" | "error" }>;
const signature = (item: Item) => `${item.type} ${formatAbiItem(item)}`;

test("the pots ABI the app uses matches the Foundry build", { skip: !existsSync(BUILD) && "no forge build output" }, () => {
  const built = (JSON.parse(readFileSync(BUILD, "utf8")) as { abi: Item[] }).abi.filter((b) =>
    ["function", "event", "error"].includes(b.type),
  );
  const builtSignatures = new Map(built.map((item) => [`${item.type} ${item.name}`, signature(item)]));
  for (const item of POTS_ABI as readonly Item[]) {
    assert.equal(signature(item), builtSignatures.get(`${item.type} ${item.name}`), item.name);
    if (item.type === "function") {
      const twin = built.find((b) => b.type === "function" && b.name === item.name) as AbiFunction;
      assert.deepEqual(
        item.outputs.map((o: AbiParameter) => formatAbiItem({ type: "function", name: "x", inputs: [o], outputs: [], stateMutability: "view" })),
        twin.outputs.map((o: AbiParameter) => formatAbiItem({ type: "function", name: "x", inputs: [o], outputs: [], stateMutability: "view" })),
        `${item.name} outputs`,
      );
    }
    if (item.type === "event") {
      const twin = built.find((b) => b.type === "event" && b.name === item.name) as AbiEvent;
      assert.deepEqual(item.inputs.map((i: AbiEvent["inputs"][number]) => i.indexed ?? false), twin.inputs.map((i: AbiEvent["inputs"][number]) => i.indexed ?? false), `${item.name} indexed`);
    }
  }
  const errors = built.filter((b) => b.type === "error").map((b) => b.name).sort();
  const ours = (POTS_ABI as readonly Item[]).filter((b) => b.type === "error").map((b) => b.name).sort();
  assert.deepEqual(ours, errors, "every custom error is listed");
});
