import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
async function setup() {
  const host = createFakePluginHost({ pluginId: "bb-profiles" });
  hosts.push(host);
  await plugin(host.bb);
  return host;
}
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});
const rule = { enabled: true, limit: true, modelIds: ["a", "b"] };

describe("profiles RPC", () => {
  it("starts with Default only and publishes each committed change", async () => {
    const { harness } = await setup();
    const empty = (await harness.behavior.callRpc("getSnapshot", null)) as {
      revision: number;
      profiles: { id: string }[];
    };
    expect(empty).toMatchObject({ revision: 0, profiles: [{ id: "default" }] });
    const next = (await harness.behavior.callRpc("setHiddenModels", {
      mode: "remove",
    })) as { revision: number; hiddenModels: string };
    expect(next).toMatchObject({ revision: 1, hiddenModels: "remove" });
    expect(harness.realtimeSignals).toHaveLength(1);
  });
  it("creates, edits, assigns and deletes profiles", async () => {
    const { harness } = await setup();
    const call = (name: string, input: unknown) =>
      harness.behavior.callRpc(name as never, input as never) as Promise<any>;
    await call("setProvider", {
      profileId: "default",
      providerId: "alpha",
      rule,
    });
    await call("setDefaultModel", {
      profileId: "default",
      defaultModel: { providerId: "alpha", model: "a", reasoningLevel: "high" },
    });
    const created = await call("createProfile", {
      name: "Work",
      copyFromId: "default",
    });
    expect(created.snapshot.profiles[1]).toMatchObject({
      id: created.id,
      name: "Work",
      projectIds: [],
      providers: { alpha: rule },
      defaultModel: { providerId: "alpha", model: "a", reasoningLevel: "high" },
    });
    await call("renameProfile", { id: created.id, name: "Client" });
    const assigned = await call("setProfileProjects", {
      id: created.id,
      projectIds: ["p1"],
    });
    expect(assigned.profiles[1]).toMatchObject({
      name: "Client",
      projectIds: ["p1"],
    });
    await expect(call("createProfile", { name: "client", copyFromId: "default" })).rejects.toThrow(/exists/);
    await expect(call("deleteProfile", { id: "default" })).rejects.toThrow(/deleted/);
    const removed = await call("deleteProfile", { id: created.id });
    expect(removed.profiles).toHaveLength(1);
    const reset = await call("reset", null);
    expect(reset.profiles[0].providers).toEqual({});
    expect(reset.revision).toBeGreaterThan(removed.revision);
  });
  it("refuses a limit with no models and strict extra fields", async () => {
    const { harness } = await setup();
    const call = (name: string, input: unknown) => harness.behavior.callRpc(name as never, input as never);
    await expect(
      call("setProvider", {
        profileId: "default",
        providerId: "alpha",
        rule: { enabled: true, limit: true, modelIds: [] },
      }),
    ).rejects.toThrow();
    await expect(
      call("setProvider", {
        profileId: "default",
        providerId: "alpha",
        rule: { ...rule, extra: 1 },
      }),
    ).rejects.toThrow();
    expect(harness.realtimeSignals).toEqual([]);
  });
  it("persists through a plugin reload", async () => {
    const { harness } = await setup();
    await harness.behavior.callRpc(
      "setProvider" as never,
      {
        profileId: "default",
        providerId: "alpha",
        rule,
      } as never,
    );
    const reloaded = await harness.lifecycle.reload(plugin);
    hosts.push(reloaded);
    const snapshot = (await reloaded.harness.behavior.callRpc("getSnapshot" as never, null as never)) as {
      revision: number;
      profiles: { providers: object }[];
    };
    expect(snapshot.revision).toBe(1);
    expect(snapshot.profiles[0].providers).toEqual({ alpha: rule });
  });
});

describe("stored documents", () => {
  const stored = (bb: Awaited<ReturnType<typeof setup>>["bb"]) => bb.storage.kv.get<unknown>("profiles");
  it("writes a versioned document and bumps the revision on each change", async () => {
    const { bb, harness } = await setup();
    await harness.behavior.callRpc("setHiddenModels" as never, { mode: "remove" } as never);
    await harness.behavior.callRpc("setHiddenModels" as never, { mode: "more" } as never);
    expect(await stored(bb)).toMatchObject({ version: 1, snapshot: { revision: 2, hiddenModels: "more" } });
  });
  it("serializes overlapping changes so none is lost", async () => {
    const { harness } = await setup();
    await Promise.all(
      ["a", "b", "c"].map((name) =>
        harness.behavior.callRpc("createProfile" as never, { name, copyFromId: "default" } as never),
      ),
    );
    const snapshot = (await harness.behavior.callRpc("getSnapshot" as never, null as never)) as {
      revision: number;
      profiles: unknown[];
    };
    expect(snapshot).toMatchObject({ revision: 3 });
    expect(snapshot.profiles).toHaveLength(4);
  });
  it.each(["not-json", { version: 999, snapshot: {} }, { version: 1, snapshot: { revision: 0 } }, { snapshot: {} }])(
    "refuses malformed state without erasing it: %j",
    async (document) => {
      const { bb, harness } = await setup();
      await bb.storage.kv.set("profiles", document);
      await expect(harness.behavior.callRpc("getSnapshot" as never, null as never)).rejects.toThrow(/stored/i);
      await expect(harness.behavior.callRpc("reset" as never, null as never)).rejects.toThrow();
      expect(await stored(bb)).toEqual(document);
      expect(harness.realtimeSignals).toEqual([]);
    },
  );
});

describe("CLI", () => {
  it("shows status and resets", async () => {
    const { harness } = await setup();
    await harness.behavior.callRpc(
      "setProvider" as never,
      {
        profileId: "default",
        providerId: "alpha",
        rule,
      } as never,
    );
    const text = await harness.behavior.runCli(["status"]);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain("alpha: on, limited to 2 models");
    const json = await harness.behavior.runCli(["status", "--json"]);
    expect(JSON.parse(json.stdout as string).revision).toBe(1);
    expect((await harness.behavior.runCli(["reset", "--json"])).exitCode).toBe(0);
    expect(
      JSON.parse((await harness.behavior.runCli(["status", "--json"])).stdout as string).profiles[0].providers,
    ).toEqual({});
    expect((await harness.behavior.runCli(["prefer", "a", "b"])).exitCode).toBe(1);
    expect((await harness.behavior.runCli(["reset", "x"])).exitCode).toBe(1);
  });
  it("exports the snapshot and imports it back, replacing everything and publishing a change", async () => {
    const { harness } = await setup();
    await harness.behavior.callRpc(
      "setProvider" as never,
      { profileId: "default", providerId: "alpha", rule } as never,
    );
    const exported = await harness.behavior.runCli(["export"]);
    expect(exported.exitCode).toBe(0);
    const snapshot = JSON.parse(exported.stdout as string);
    expect(snapshot).toMatchObject({ revision: 1, profiles: [{ id: "default", providers: { alpha: rule } }] });
    expect(JSON.parse((await harness.behavior.runCli(["export", "--json"])).stdout as string)).toEqual(snapshot);

    const dir = await mkdtemp(join(tmpdir(), "profiles-import-"));
    try {
      await harness.behavior.runCli(["reset"]);
      await writeFile(join(dir, "backup.json"), JSON.stringify(snapshot));
      const before = harness.realtimeSignals.length;
      const imported = await harness.behavior.runCli(["import", "backup.json", "--json"], { cwd: dir });
      expect(imported.exitCode).toBe(0);
      expect(JSON.parse(imported.stdout as string)).toMatchObject({
        revision: 3,
        profiles: [{ providers: { alpha: rule } }],
      });
      expect(harness.realtimeSignals).toHaveLength(before + 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("refuses an import it cannot validate and keeps the stored profiles", async () => {
    const { harness } = await setup();
    await harness.behavior.callRpc(
      "setProvider" as never,
      { profileId: "default", providerId: "alpha", rule } as never,
    );
    const dir = await mkdtemp(join(tmpdir(), "profiles-import-"));
    try {
      await writeFile(join(dir, "bad.json"), JSON.stringify({ revision: 0, hiddenModels: "more", profiles: [] }));
      await writeFile(join(dir, "broken.json"), "{");
      for (const file of ["bad.json", "broken.json", "missing.json"]) {
        const result = await harness.behavior.runCli(["import", file], { cwd: dir });
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(file);
      }
      expect((await harness.behavior.runCli(["import"])).exitCode).toBe(1);
      const status = JSON.parse((await harness.behavior.runCli(["status", "--json"])).stdout as string);
      expect(status.profiles[0].providers).toEqual({ alpha: rule });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("custom models", () => {
  async function withDataDir() {
    const dataDir = await mkdtemp(join(tmpdir(), "profiles-server-"));
    const reloadConfig = vi.fn(async () => ({ ok: true }));
    const host = createFakePluginHost({
      pluginId: "bb-profiles",
      dataDir,
      sdk: {
        system: {
          reloadConfig,
          executionOptions: async () => ({
            models: [{ model: "native" }],
            selectedOnlyModels: [{ model: "hidden-native" }],
          }),
        },
      } as never,
    });
    hosts.push(host);
    await plugin(host.bb);
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    return { host, dataDir, reloadConfig };
  }
  const cleanups: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("adds, lists and removes through RPC, publishing a change each time", async () => {
    const { host, dataDir, reloadConfig } = await withDataDir();
    const call = (name: string, input: unknown) =>
      host.harness.behavior.callRpc(name as never, input as never) as Promise<any>;
    const added = await call("addCustomModel", {
      providerId: "acp-cursor",
      model: "grok-4.7",
      displayName: "Grok 4.7",
    });
    expect(added.models).toEqual([{ providerId: "acp-cursor", model: "grok-4.7", displayName: "Grok 4.7" }]);
    expect(JSON.parse(await readFile(join(dataDir, "config.json"), "utf8"))).toEqual({ customModels: added.models });
    expect((await call("listCustomModels", null)).models).toHaveLength(1);
    await expect(call("addCustomModel", { providerId: "acp-cursor", model: "native" })).rejects.toThrow(
      /already lists/,
    );
    await expect(
      call("addCustomModel", {
        providerId: "acp-cursor",
        model: "hidden-native",
      }),
    ).rejects.toThrow(/already lists/);
    await call("removeCustomModel", {
      providerId: "acp-cursor",
      model: "grok-4.7",
    });
    expect((await call("listCustomModels", null)).models).toEqual([]);
    expect(reloadConfig).toHaveBeenCalledTimes(2);
    expect(host.harness.realtimeSignals).toHaveLength(2);
  });

  it("drives the CLI and refuses a config it cannot parse", async () => {
    const { host, dataDir } = await withDataDir();
    const cli = (...argv: string[]) => host.harness.behavior.runCli(argv);
    expect((await cli("models", "list")).stdout).toBe("No custom models");
    const add = await cli("models", "add", "p", "m1", "My", "Model", "--json");
    expect(JSON.parse(add.stdout as string).models).toEqual([
      { providerId: "p", model: "m1", displayName: "My Model" },
    ]);
    expect((await cli("models", "list")).stdout).toBe("p/m1 (My Model)");
    expect((await cli("models", "remove", "p", "m1")).exitCode).toBe(0);
    expect((await cli("models", "add", "p")).exitCode).toBe(1);
    await writeFile(join(dataDir, "config.json"), "oops");
    const bad = await cli("models", "add", "p", "m2");
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toMatch(/not valid JSON/);
    expect(await readFile(join(dataDir, "config.json"), "utf8")).toBe("oops");
  });
});
