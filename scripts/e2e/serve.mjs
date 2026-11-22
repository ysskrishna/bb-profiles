// Keeps an isolated scratch BB with this plugin running for README captures.
// Usage: npm run e2e:serve -- [--minutes 120]
// It seeds three demo projects, writes e2e-artifacts/serve.json (URL, CLI path,
// projects) and e2e-artifacts/serve.env (the scratch environment for the BB
// CLI; paths and ports only), then waits until the time is up or it is
// interrupted, and deletes all scratch data.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startScratchServer } from "./server.mjs";

const args = process.argv.slice(2);
const minutesIndex = args.indexOf("--minutes");
const minutes = Number(minutesIndex < 0 ? 120 : args[minutesIndex + 1]);
const server = await startScratchServer({ projectNames: ["Payments service", "Mobile app", "Docs site"] });
try {
  writeFileSync(
    resolve("e2e-artifacts/serve.json"),
    JSON.stringify({ url: server.url, bb: server.bb, projects: server.projects, scratch: server.scratch }, null, 2),
  );
  writeFileSync(
    resolve("e2e-artifacts/serve.env"),
    `${Object.entries(server.env)
      .filter(([key]) => !/^npm_/i.test(key))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
  );
  console.log(`SERVING: ${server.url} for ${minutes} minutes; details in e2e-artifacts/serve.json`);
  const until = Date.now() + minutes * 60_000;
  while (Date.now() < until) {
    await delay(5_000);
    await server.checkIsolation("monitor");
  }
} finally {
  await server.cleanup();
}
