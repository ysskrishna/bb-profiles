// Custom model IDs live in BB's own config file (`<dataDir>/config.json`, top-level
// `customModels`). BB has no plugin API for editing them, so this module reads and
// rewrites that one key carefully: every other key and unknown entry field is kept,
// an unreadable file is never overwritten, and the write is a temp file plus rename.
import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MAX_CUSTOM_NAME_LENGTH, validId } from "./profiles";

export interface CustomModel {
  providerId: string;
  model: string;
  displayName?: string;
}
export interface CustomModelsResult {
  models: CustomModel[];
  /** Set when the file was saved but BB could not reload its config. */
  warning?: string;
}

/** A change the caller asked for that cannot be made. */
export class CustomModelError extends Error {}

interface CustomModelsDeps {
  dataDir: () => string;
  /** True when BB's own catalog for the provider already lists the model. */
  hasNativeModel: (providerId: string, model: string) => Promise<boolean>;
  reload: () => Promise<unknown>;
}

type Entry = Record<string, unknown>;
type Config = Record<string, unknown>;

const isObject = (value: unknown): value is Config =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function visible(entry: unknown): entry is Entry & CustomModel {
  return (
    isObject(entry) &&
    validId(entry.providerId) &&
    validId(entry.model) &&
    (entry.displayName === undefined || typeof entry.displayName === "string")
  );
}

function project(entry: CustomModel): CustomModel {
  const { providerId, model, displayName } = entry;
  return displayName ? { providerId, model, displayName } : { providerId, model };
}

export function createCustomModels(deps: CustomModelsDeps) {
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };
  const path = () => join(deps.dataDir(), "config.json");

  /** The parsed file and its custom models; refuses anything it could damage. */
  async function load(): Promise<{
    config: Config;
    entries: unknown[];
    exists: boolean;
  }> {
    let text: string;
    try {
      text = await readFile(path(), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { config: {}, entries: [], exists: false };
      throw new CustomModelError(`Cannot read BB's config file: ${(error as Error).message}`);
    }
    let config: unknown;
    try {
      config = JSON.parse(text);
    } catch {
      throw new CustomModelError("BB's config file is not valid JSON, so it was left unchanged.");
    }
    if (!isObject(config))
      throw new CustomModelError("BB's config file is not a JSON object, so it was left unchanged.");
    const entries = config.customModels;
    if (entries !== undefined && !Array.isArray(entries))
      throw new CustomModelError("BB's customModels setting is not a list, so the config file was left unchanged.");
    return { config, entries: entries ?? [], exists: true };
  }

  async function write(config: Config, entries: unknown[]): Promise<void> {
    const file = path();
    const tmp = `${file}.${randomUUID()}.tmp`;
    const mode = await stat(file).then(
      (info) => info.mode & 0o777,
      () => 0o600,
    );
    const text = `${JSON.stringify({ ...config, customModels: entries }, null, 2)}\n`;
    try {
      await writeFile(tmp, text, { flag: "wx", mode });
      await chmod(tmp, mode);
      await rename(tmp, file);
    } catch (error) {
      await unlink(tmp).catch(() => undefined);
      throw new CustomModelError(`Cannot write BB's config file: ${(error as Error).message}`);
    }
  }

  async function finish(entries: unknown[]): Promise<CustomModelsResult> {
    const models = entries.filter(visible).map(project);
    try {
      await deps.reload();
      return { models };
    } catch (error) {
      return {
        models,
        warning: `Saved, but BB could not reload its config (${(error as Error).message}). Restart BB to apply.`,
      };
    }
  }

  return {
    async list(): Promise<CustomModel[]> {
      return (await load()).entries.filter(visible).map(project);
    },

    add(input: CustomModel): Promise<CustomModelsResult> {
      return serialize(async () => {
        const { providerId, model } = input;
        const displayName = input.displayName?.trim();
        if (!validId(providerId)) throw new CustomModelError("Invalid provider ID");
        if (!validId(model)) throw new CustomModelError("Invalid model ID");
        if (displayName !== undefined && (displayName.length < 1 || displayName.length > MAX_CUSTOM_NAME_LENGTH))
          throw new CustomModelError(`Name must be 1-${MAX_CUSTOM_NAME_LENGTH} characters`);
        const { config, entries } = await load();
        if (entries.some((e) => visible(e) && e.providerId === providerId && e.model === model))
          throw new CustomModelError(`${model} is already a custom model for ${providerId}`);
        if (await deps.hasNativeModel(providerId, model))
          throw new CustomModelError(`BB already lists ${model} for ${providerId}`);
        const next = [...entries, displayName ? { providerId, model, displayName } : { providerId, model }];
        await write(config, next);
        return finish(next);
      });
    },

    remove(input: { providerId: string; model: string }): Promise<CustomModelsResult> {
      return serialize(async () => {
        const { config, entries, exists } = await load();
        const next = entries.filter(
          (e) => !(visible(e) && e.providerId === input.providerId && e.model === input.model),
        );
        if (!exists || next.length === entries.length)
          throw new CustomModelError(`${input.model} is not a custom model for ${input.providerId}`);
        await write(config, next);
        return finish(next);
      });
    },
  };
}
