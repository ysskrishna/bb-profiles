import type { HiddenModels, Profile, ProviderRule, Snapshot } from "./profiles";

export const limit = (...modelIds: string[]): ProviderRule => ({
  enabled: true,
  limit: true,
  modelIds,
});
export const off: ProviderRule = { enabled: false, limit: false, modelIds: [] };
export function profile(
  id: string,
  providers: Record<string, ProviderRule> = {},
  extra: Partial<Profile> = {},
): Profile {
  return {
    id,
    name: id === "default" ? "Default" : id,
    projectIds: [],
    providers,
    ...extra,
  };
}
/** A snapshot whose Default profile carries `providers`. */
export function snapshotOf(
  providers: Record<string, ProviderRule> = {},
  options: {
    revision?: number;
    hiddenModels?: HiddenModels;
    others?: Profile[];
    defaultModel?: Profile["defaultModel"];
  } = {},
): Snapshot {
  return {
    revision: options.revision ?? 1,
    hiddenModels: options.hiddenModels ?? "more",
    profiles: [profile("default", providers, { defaultModel: options.defaultModel }), ...(options.others ?? [])],
  };
}
export const pickerState = (
  snapshot: Snapshot,
  extra: {
    environmentProjects?: Record<string, string | null>;
    composerProjectId?: string | null;
  } = {},
) => ({
  snapshot,
  environmentProjects: extra.environmentProjects ?? {},
  composerProjectId: extra.composerProjectId ?? null,
});
