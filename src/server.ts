import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { experimental_PluginRpcRefusal, type BbPluginApi } from "@get-bb/plugin-sdk";
import { CUSTOM_MODELS_CHANGED, PROFILES_CHANGED } from "./channels";
import { rpcContract } from "./contract";
import { CustomModelError, createCustomModels, type CustomModelsResult } from "./server-custom-models";
import {
  createProfile,
  parseSnapshot,
  deleteProfile,
  getProviderRule,
  INITIAL_SNAPSHOT,
  ProfileError,
  renameProfile,
  setDefaultModel,
  setHiddenModels,
  setProfileProjects,
  setProvider,
  type Snapshot,
} from "./profiles";
import { createProfilesStore } from "./server-store";

export { rpcContract } from "./contract";

export function format(snapshot: Snapshot): string {
  const lines = [
    `Revision ${snapshot.revision}`,
    `Hidden models: ${snapshot.hiddenModels === "more" ? "shown under More models" : "removed from the picker"}`,
  ];
  for (const profile of snapshot.profiles) {
    lines.push("", `${profile.name} (${profile.id})`);
    lines.push(
      `  Projects: ${profile.projectIds.length ? profile.projectIds.join(", ") : profile.id === "default" ? "all other projects" : "none"}`,
    );
    const dm = profile.defaultModel;
    lines.push(
      `  Default model: ${dm ? `${dm.providerId}/${dm.model}${dm.reasoningLevel ? ` (${dm.reasoningLevel})` : ""}` : "none"}`,
    );
    const providers = Object.keys(profile.providers);
    if (providers.length === 0) lines.push("  Providers: all on, no limits");
    for (const id of providers) {
      const rule = getProviderRule(profile, id)!;
      lines.push(
        `  ${id}: ${rule.enabled ? "on" : "off"}${rule.limit ? `, limited to ${rule.modelIds.length} models` : ""}`,
      );
    }
  }
  return lines.join("\n");
}

export default function plugin(bb: BbPluginApi) {
  const store = createProfilesStore(bb.storage.kv);

  async function commit(change: (current: Snapshot) => Snapshot): Promise<Snapshot> {
    let result: Snapshot;
    try {
      result = await store.mutate(change);
    } catch (error) {
      if (error instanceof ProfileError)
        throw new experimental_PluginRpcRefusal({
          code: "invalid",
          message: error.message,
        });
      throw error;
    }
    bb.realtime.publish(PROFILES_CHANGED, { revision: result.revision });
    return result;
  }

  async function importSnapshot(file: string): Promise<Snapshot> {
    let snapshot: Snapshot;
    try {
      snapshot = parseSnapshot(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      throw new ProfileError(`Cannot import ${file}: ${error instanceof Error ? error.message : "invalid file"}`);
    }
    const result = await store.replace(snapshot);
    bb.realtime.publish(PROFILES_CHANGED, { revision: result.revision });
    return result;
  }

  const customModels = createCustomModels({
    dataDir: () => bb.server.experimental_dataDir,
    hasNativeModel: async (providerId, model) => {
      const options = await bb.sdk.system.executionOptions({ providerId });
      return [...options.models, ...options.selectedOnlyModels].some((m) => m.model === model);
    },
    reload: () => bb.sdk.system.reloadConfig(),
  });

  async function changeCustomModels(change: () => Promise<CustomModelsResult>): Promise<CustomModelsResult> {
    let result: CustomModelsResult;
    try {
      result = await change();
    } catch (error) {
      if (error instanceof CustomModelError)
        throw new experimental_PluginRpcRefusal({
          code: "invalid",
          message: error.message,
        });
      throw error;
    }
    bb.realtime.publish(CUSTOM_MODELS_CHANGED, {});
    return result;
  }

  bb.rpc.register(rpcContract, {
    getSnapshot: () => store.read(),
    setHiddenModels: ({ mode }) => commit((s) => setHiddenModels(s, mode)),
    createProfile: async ({ name, copyFromId }) => {
      const id = `p_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const snapshot = await commit((s) => createProfile(s, name, copyFromId, id).snapshot);
      return { snapshot, id };
    },
    renameProfile: ({ id, name }) => commit((s) => renameProfile(s, id, name)),
    deleteProfile: ({ id }) => commit((s) => deleteProfile(s, id)),
    setProfileProjects: ({ id, projectIds }) => commit((s) => setProfileProjects(s, id, projectIds)),
    setProvider: ({ profileId, providerId, rule }) => commit((s) => setProvider(s, profileId, providerId, rule)),
    setDefaultModel: ({ profileId, defaultModel }) => commit((s) => setDefaultModel(s, profileId, defaultModel)),
    reset: () => commit(() => INITIAL_SNAPSHOT),
    listCustomModels: async () => {
      try {
        return { models: await customModels.list() };
      } catch (error) {
        if (error instanceof CustomModelError)
          throw new experimental_PluginRpcRefusal({
            code: "invalid",
            message: error.message,
          });
        throw error;
      }
    },
    addCustomModel: (input) => changeCustomModels(() => customModels.add(input)),
    removeCustomModel: (input) => changeCustomModels(() => customModels.remove(input)),
  });

  const usage =
    "Usage: bb profiles status [--json] | reset [--json] | export [--json] | import <file> [--json] | models list [--json] | models add <provider> <model> [display name...] [--json] | models remove <provider> <model> [--json]";
  bb.cli.register({
    name: "profiles",
    summary: "Inspect, reset, back up and restore per-project model profiles",
    commands: [
      {
        name: "status",
        summary: "Show profiles, their projects, provider rules and defaults",
        usage: "bb profiles status [--json]",
      },
      {
        name: "reset",
        summary: "Remove every profile and rule",
        usage: "bb profiles reset [--json]",
      },
      {
        name: "export",
        summary: "Print every profile and rule as JSON, for backup or moving to another BB server",
        usage: "bb profiles export [--json]",
      },
      {
        name: "import",
        summary: "Replace every profile and rule with the contents of an exported JSON file",
        usage: "bb profiles import <file> [--json]",
      },
      {
        name: "models",
        summary: "List, add or remove custom model IDs",
        usage:
          "bb profiles models list [--json] | add <provider> <model> [display name...] | remove <provider> <model>",
      },
    ],
    async run(argv, ctx) {
      const json = argv.includes("--json");
      const [command, ...args] = argv.filter((arg) => arg !== "--json");
      if (command === undefined || command === "help" || command === "--help") return { exitCode: 0, stdout: usage };
      try {
        if (command === "models") {
          const [action, providerId, model, ...name] = args;
          let result: CustomModelsResult;
          if (action === "list" && !providerId) result = { models: await customModels.list() };
          else if (action === "add" && providerId && model)
            result = await changeCustomModels(() =>
              customModels.add({ providerId, model, displayName: name.join(" ").trim() || undefined }),
            );
          else if (action === "remove" && providerId && model && !name.length)
            result = await changeCustomModels(() => customModels.remove({ providerId, model }));
          else return { exitCode: 1, stderr: usage };
          const lines = result.models.map(
            (m) => `${m.providerId}/${m.model}${m.displayName ? ` (${m.displayName})` : ""}`,
          );
          return {
            exitCode: 0,
            stdout: json
              ? JSON.stringify(result)
              : [...(lines.length ? lines : ["No custom models"]), ...(result.warning ? [result.warning] : [])].join(
                  "\n",
                ),
          };
        }
        let snapshot: Snapshot;
        if (command === "status" && args.length === 0) snapshot = await store.read();
        else if (command === "export" && args.length === 0)
          return { exitCode: 0, stdout: JSON.stringify(await store.read(), null, 2) };
        else if (command === "reset" && args.length === 0) snapshot = await commit(() => INITIAL_SNAPSHOT);
        else if (command === "import" && args.length === 1)
          snapshot = await importSnapshot(resolve(ctx.cwd ?? process.cwd(), args[0]));
        else return { exitCode: 1, stderr: usage };
        return { exitCode: 0, stdout: json ? JSON.stringify(snapshot) : format(snapshot) };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: error instanceof Error ? error.message.slice(0, 2048) : "Cannot update profiles",
        };
      }
    },
  });
}
