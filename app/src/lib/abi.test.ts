import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { formatAbiItem } from "viem/utils";
import type { Abi, AbiEvent, AbiFunction, AbiParameter } from "viem";
import { NAMES_ABI, POTS_ABI } from "./abi.ts";

const build = (name: string) => new URL(`../../../out/${name}.sol/${name}.json`, import.meta.url);

type Item = Extract<Abi[number], { type: "function" | "event" | "error" }>;
const signature = (item: Item) => `${item.type} ${formatAbiItem(item)}`;

function matchesBuild(contract: string, ours: readonly Item[]) {
  const built = (JSON.parse(readFileSync(build(contract), "utf8")) as { abi: Item[] }).abi.filter((b) =>
    ["function", "event", "error"].includes(b.type),
  );
  const builtSignatures = new Map(built.map((item) => [`${item.type} ${item.name}`, signature(item)]));
  for (const item of ours) {
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
  const ourErrors = ours.filter((b) => b.type === "error").map((b) => b.name).sort();
  assert.deepEqual(ourErrors, errors, "every custom error is listed");
}

test("the pots ABI the app uses matches the Foundry build", { skip: !existsSync(build("NivPayPots")) && "no forge build output" }, () => {
  matchesBuild("NivPayPots", POTS_ABI as readonly Item[]);
});

test("the usernames ABI the app uses matches the Foundry build", { skip: !existsSync(build("NivPayNames")) && "no forge build output" }, () => {
  matchesBuild("NivPayNames", NAMES_ABI as readonly Item[]);
});
