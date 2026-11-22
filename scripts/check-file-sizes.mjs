import { readdirSync, readFileSync } from "node:fs";

// Physical line ceilings after formatting: production files and scripts 500, tests 1,000.
const sourceFiles = (dir, pattern) =>
  readdirSync(dir, { recursive: true })
    .filter((name) => pattern.test(name))
    .map((name) => `${dir}/${name}`);
const files = [
  "app.tsx",
  ...sourceFiles("src", /\.(ts|tsx)$/),
  ...sourceFiles("components", /\.(ts|tsx)$/),
  ...sourceFiles("lib", /\.(ts|tsx)$/),
  ...sourceFiles("scripts", /\.mjs$/),
];
let failures = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const lines = source.length === 0 ? 0 : source.split(/\r?\n/).length - Number(source.endsWith("\n"));
  const limit = /\.test\.(ts|tsx|mjs)$/.test(file) ? 1000 : 500;
  if (lines > limit) {
    console.error(`${file}: ${lines} lines exceeds the ${limit}-line budget. Split the file before adding more.`);
    failures++;
  }
}
if (failures > 0) process.exitCode = 1;
else console.log("File-size budgets passed.");
