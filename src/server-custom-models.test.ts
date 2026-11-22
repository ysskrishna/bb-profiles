import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomModelError, createCustomModels } from "./server-custom-models";

let dir: string;
let native: Set<string>;
let reload: ReturnType<typeof vi.fn>;
const file = () => join(dir, "config.json");
const read = async () => JSON.parse(await readFile(file(), "utf8"));
const make = () =>
  createCustomModels({
    dataDir: () => dir,
    hasNativeModel: async (providerId, model) => native.has(`${providerId}/${model}`),
    reload: reload as () => Promise<unknown>,
  });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "custom-models-"));
  native = new Set();
  reload = vi.fn(async () => ({ ok: true }));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("custom models", () => {
  it("creates the file when it is missing, with a trailing newline", async () => {
    const result = await make().add({
      providerId: "acp-cursor",
      model: "grok-4.7",
      displayName: "  Grok 4.7 ",
    });
    expect(result).toEqual({
      models: [
        {
          providerId: "acp-cursor",
          model: "grok-4.7",
          displayName: "Grok 4.7",
        },
      ],
    });
    const text = await readFile(file(), "utf8");
    expect(text.endsWith("}\n")).toBe(true);
    expect(JSON.parse(text)).toEqual({
      customModels: [
        {
          providerId: "acp-cursor",
          model: "grok-4.7",
          displayName: "Grok 4.7",
        },
      ],
    });
    expect(await make().list()).toHaveLength(1);
  });

  it("lists nothing when the file or key is missing", async () => {
    expect(await make().list()).toEqual([]);
    await writeFile(file(), "{}");
    expect(await make().list()).toEqual([]);
  });

  it("keeps other keys and unknown entry fields", async () => {
    await writeFile(
      file(),
      JSON.stringify({
        theme: "dark",
        nested: { a: [1] },
        customModels: [{ providerId: "p", model: "old", extra: { keep: true } }, { broken: true }],
      }),
    );
    await make().add({ providerId: "p", model: "new" });
    expect(await read()).toEqual({
      theme: "dark",
      nested: { a: [1] },
      customModels: [
        { providerId: "p", model: "old", extra: { keep: true } },
        { broken: true },
        { providerId: "p", model: "new" },
      ],
    });
    await make().remove({ providerId: "p", model: "new" });
    expect((await read()).customModels).toHaveLength(2);
    expect((await read()).customModels[0].extra).toEqual({ keep: true });
  });

  it("refuses unreadable config shapes without overwriting them", async () => {
    for (const text of ["{ not json", "[1, 2]", JSON.stringify({ customModels: { providerId: "p" } })]) {
      await writeFile(file(), text);
      await expect(make().add({ providerId: "p", model: "m" })).rejects.toBeInstanceOf(CustomModelError);
      await expect(make().list()).rejects.toBeInstanceOf(CustomModelError);
      await expect(make().remove({ providerId: "p", model: "m" })).rejects.toBeInstanceOf(CustomModelError);
      expect(await readFile(file(), "utf8")).toBe(text);
    }
    expect(reload).not.toHaveBeenCalled();
  });

  it("refuses duplicates, native models and invalid input", async () => {
    const models = make();
    await models.add({ providerId: "p", model: "m" });
    await expect(models.add({ providerId: "p", model: "m" })).rejects.toThrow(/already a custom model/);
    native.add("p/n");
    await expect(models.add({ providerId: "p", model: "n" })).rejects.toThrow(/already lists n/);
    await expect(models.add({ providerId: "p", model: " " })).rejects.toThrow(/Invalid model ID/);
    await expect(models.add({ providerId: "p", model: "x", displayName: "a".repeat(81) })).rejects.toThrow(
      /Name must be/,
    );
    await expect(models.add({ providerId: "p", model: "x", displayName: "  " })).rejects.toThrow(/Name must be/);
    expect((await read()).customModels).toHaveLength(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("removes only the entry matching both fields", async () => {
    const models = make();
    await models.add({ providerId: "a", model: "m" });
    await models.add({ providerId: "b", model: "m" });
    const result = await models.remove({ providerId: "a", model: "m" });
    expect(result.models).toEqual([{ providerId: "b", model: "m" }]);
    await expect(models.remove({ providerId: "a", model: "m" })).rejects.toThrow(/not a custom model/);
    await expect(make().remove({ providerId: "zzz", model: "m" })).rejects.toBeInstanceOf(CustomModelError);
  });

  it("replaces the file through a temp file and leaves no temp behind", async () => {
    await writeFile(file(), "{}", { mode: 0o640 });
    const before = (await stat(file())).ino;
    await make().add({ providerId: "p", model: "m" });
    const after = await stat(file());
    expect(after.ino).not.toBe(before);
    expect(after.mode & 0o777).toBe(0o640);
    expect(await readdir(dir)).toEqual(["config.json"]);
  });

  it("does not leave a temp file when the write fails", async () => {
    await mkdir(file());
    await expect(make().add({ providerId: "p", model: "m" })).rejects.toBeInstanceOf(CustomModelError);
    expect(await readdir(dir)).toEqual(["config.json"]);
  });

  it("reloads once per write and returns a warning when reload fails", async () => {
    const models = make();
    await models.add({ providerId: "p", model: "a" });
    expect(reload).toHaveBeenCalledTimes(1);
    reload.mockRejectedValueOnce(new Error("offline"));
    const result = await models.add({ providerId: "p", model: "b" });
    expect(result.warning).toMatch(/Saved, but BB could not reload.*offline/);
    expect(result.models).toHaveLength(2);
    expect((await read()).customModels).toHaveLength(2);
    await models.remove({ providerId: "p", model: "b" });
    expect(reload).toHaveBeenCalledTimes(3);
  });

  it("serializes concurrent writes", async () => {
    const models = make();
    await Promise.all(["a", "b", "c", "d"].map((model) => models.add({ providerId: "p", model })));
    expect((await read()).customModels.map((e: any) => e.model)).toEqual(["a", "b", "c", "d"]);
  });
});
