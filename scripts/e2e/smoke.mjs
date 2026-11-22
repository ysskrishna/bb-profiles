// Installs the plugin on an isolated scratch BB and checks its CLI end to end:
// status, export, and an import round trip. No browser and no credentials.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { startScratchServer } from "./server.mjs";

const server = await startScratchServer({ projectNames: ["Payments service", "Mobile app"] });
try {
  const profiles = async (argv) => JSON.parse((await server.cli(["profiles", ...argv, "--json"])).stdout);

  const initial = await profiles(["status"]);
  assert.equal(initial.profiles.length, 1, "a fresh install has the one default profile");
  const exported = await profiles(["export"]);
  assert.deepEqual(exported, initial);

  const extra = { id: "p_smoke", name: "Smoke", projectIds: [server.projects[0].id], providers: {} };
  const edited = { ...exported, profiles: [...exported.profiles, extra] };
  const file = join(server.scratch, "profiles.json");
  writeFileSync(file, JSON.stringify(edited));
  await server.cli(["profiles", "import", file, "--json"]);
  assert.equal((await profiles(["status"])).profiles[1].name, "Smoke");

  await server.checkIsolation("complete");
  console.log("PASS: status, export and import round trip on a scratch BB");
} catch (error) {
  await server.diagnostics();
  throw error;
} finally {
  await server.cleanup();
}
