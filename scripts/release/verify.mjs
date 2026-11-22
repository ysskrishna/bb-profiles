import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tag = process.argv[2] ?? "";
assert.match(tag, /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "Expected a stable tag such as v0.1.0");
const version = tag.slice(1);
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
assert.ok(
  [manifest.version, lock.version, lock.packages?.[""]?.version].every((value) => value === version),
  `package.json and package-lock.json must all match tag ${tag}`,
);
console.log(`Release manifests match ${version}`);
