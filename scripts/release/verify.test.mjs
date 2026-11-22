import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const script = resolve("scripts/release/verify.mjs");
function verify(tag, versions = ["0.1.0", "0.1.0", "0.1.0"]) {
  const cwd = mkdtempSync(join(tmpdir(), "profiles-release-"));
  try {
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ version: versions[0] }));
    writeFileSync(
      join(cwd, "package-lock.json"),
      JSON.stringify({ version: versions[1], packages: { "": { version: versions[2] } } }),
    );
    return execFileSync(process.execPath, [script, ...(tag ? [tag] : [])], { cwd, stdio: "pipe", encoding: "utf8" });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
test("accepts a stable tag matching both manifests", () => {
  assert.match(verify("v0.1.0"), /0\.1\.0/);
});
for (const tag of [undefined, "0.1.0", "v1", "v01.1.0", "v0.1.0-beta.1", "v0.1.0+build", "v0.1.0-extra\n"]) {
  test(`rejects unsupported release tag ${JSON.stringify(tag)}`, () => {
    assert.throws(() => verify(tag), /Expected a stable tag/);
  });
}
for (const versions of [
  ["0.1.0-dev.0", "0.1.0-dev.0", "0.1.0-dev.0"],
  ["0.1.0", "0.2.0", "0.1.0"],
  ["0.1.0", "0.1.0", "0.2.0"],
]) {
  test(`rejects manifest versions ${versions.join(", ")}`, () => {
    assert.throws(() => verify("v0.1.0", versions), /must all match tag/);
  });
}
