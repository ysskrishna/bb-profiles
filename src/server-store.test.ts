import { describe, expect, it } from "vitest";
import { INITIAL_SNAPSHOT } from "./profiles";
import { createProfilesStore } from "./server-store";

function memoryKv(initial?: unknown) {
  const rows = new Map<string, unknown>(initial === undefined ? [] : [["profiles", initial]]);
  return {
    rows,
    kv: {
      get: async <T>(key: string) => rows.get(key) as T | undefined,
      set: async (key: string, value: unknown) => {
        await Promise.resolve();
        rows.set(key, structuredClone(value));
      },
      delete: async (key: string) => void rows.delete(key),
      list: async () => [...rows.keys()],
    },
  };
}

describe("profiles store", () => {
  it("reads the initial snapshot before anything is stored", async () => {
    expect(await createProfilesStore(memoryKv().kv).read()).toBe(INITIAL_SNAPSHOT);
  });
  it("applies changes in order, whatever their timing, and bumps the revision each time", async () => {
    const { kv, rows } = memoryKv();
    const store = createProfilesStore(kv);
    const results = await Promise.all(
      [1, 2, 3].map((n) =>
        store.mutate((s) => ({
          ...s,
          profiles: [...s.profiles, { id: `p${n}`, name: `P${n}`, projectIds: [], providers: {} }],
        })),
      ),
    );
    expect(results.map((r) => r.revision)).toEqual([1, 2, 3]);
    expect((await store.read()).profiles.map((p) => p.id)).toEqual(["default", "p1", "p2", "p3"]);
    expect(rows.get("profiles")).toMatchObject({ version: 1, snapshot: { revision: 3 } });
  });
  it("keeps accepting changes after one fails, and stores nothing for the failed one", async () => {
    const { kv } = memoryKv();
    const store = createProfilesStore(kv);
    await expect(
      store.mutate(() => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");
    await expect(store.mutate((s) => ({ ...s, profiles: [] }))).rejects.toThrow();
    expect((await store.mutate((s) => s)).revision).toBe(1);
  });
  it("rejects a result that is not a valid snapshot instead of storing it", async () => {
    const { kv, rows } = memoryKv();
    await expect(createProfilesStore(kv).mutate((s) => ({ ...s, hiddenModels: "x" as never }))).rejects.toThrow();
    expect(rows.size).toBe(0);
  });
  it("replaces the whole snapshot on top of the current revision", async () => {
    const { kv } = memoryKv();
    const store = createProfilesStore(kv);
    await store.mutate((s) => s);
    await store.mutate((s) => s);
    const replaced = await store.replace({ ...INITIAL_SNAPSHOT, revision: 0, hiddenModels: "remove" });
    expect(replaced).toMatchObject({ revision: 3, hiddenModels: "remove" });
  });
  it("replaces over an unreadable stored document", async () => {
    const { kv, rows } = memoryKv("garbage");
    const store = createProfilesStore(kv);
    await expect(store.read()).rejects.toThrow(/Cannot read stored profiles/);
    const replaced = await store.replace({ ...INITIAL_SNAPSHOT, revision: 7 });
    expect(replaced.revision).toBe(8);
    expect(rows.get("profiles")).toMatchObject({ version: 1 });
  });
  it.each([
    ["not an object", "x"],
    ["no version", { snapshot: INITIAL_SNAPSHOT }],
    ["unknown version", { version: 2, snapshot: INITIAL_SNAPSHOT }],
    ["invalid snapshot", { version: 1, snapshot: { revision: 0 } }],
  ])("refuses a stored document with %s", async (_label, document) => {
    await expect(createProfilesStore(memoryKv(document).kv).read()).rejects.toThrow(/Cannot read stored profiles/);
  });
});
