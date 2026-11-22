import type { KnipConfig } from "knip";

// The SDK loads these peer dependencies even without direct source imports.
const sdkPeerDependencies = ["hono", "better-sqlite3"];

const config: KnipConfig = {
  entry: ["app.tsx", "src/server.ts", "scripts/**/*.mjs"],
  project: ["app.tsx", "src/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.ts", "scripts/**/*.mjs"],
  ignoreDependencies: sdkPeerDependencies,
};

export default config;
