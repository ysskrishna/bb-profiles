import { getProviderRule, resolveProfile, type Profile, type Snapshot } from "./profiles";

interface Selection {
  projectId?: string;
  providerId?: string;
  model?: string;
  reasoningLevel?: string;
}
/** What the plugin remembers about one composer draft. */
export interface DraftState {
  /** Project the last decision was made for; undefined before the first one. */
  project?: string | null;
  /** Provider and model after the last apply. */
  applied?: { providerId?: string; model?: string };
  /** The user chose a provider or model in this draft; stop auto-applying. */
  userPicked: boolean;
}
interface Plan {
  state: DraftState;
  /** Selection to write to the composer, never carrying a service tier. */
  apply?: { providerId: string; model?: string; reasoningLevel?: string };
}

function allows(profile: Profile, selection: Selection): boolean {
  if (!selection.providerId) return true;
  const rule = getProviderRule(profile, selection.providerId);
  if (rule?.enabled === false) return false;
  return !rule?.limit || !selection.model || rule.modelIds.includes(selection.model);
}

/** Decide what a new-thread composer should select for its project's profile.
 * Rules: apply on first sight of an empty draft and whenever the project
 * changes, unless the user changed provider or model since our last apply.
 * `providers` are the available provider ids in catalog order (null while
 * loading); they are only used to leave a provider the profile turned off.
 */
export function planDefault(
  previous: DraftState | undefined,
  selection: Selection,
  snapshot: Snapshot,
  options: { draftEmpty: boolean; providers: readonly string[] | null },
): Plan {
  const projectId = selection.projectId ?? null;
  const state: DraftState = previous ?? { userPicked: false };
  if (previous === undefined && !options.draftEmpty) return { state: { project: projectId, userPicked: true } };
  const projectChanged = state.project !== projectId;
  // A pick survives a project switch only while the new project's profile
  // still allows it; otherwise the profile decides again.
  if (state.userPicked) {
    if (!projectChanged || allows(resolveProfile(snapshot, projectId), selection))
      return { state: { ...state, project: projectId } };
  }
  if (
    !projectChanged &&
    state.applied &&
    (state.applied.providerId !== selection.providerId || state.applied.model !== selection.model)
  )
    return { state: { ...state, userPicked: true } };
  if (!projectChanged && state.applied) return { state };

  const profile = resolveProfile(snapshot, projectId);
  const target = profile.defaultModel;
  let apply: Plan["apply"];
  if (target) {
    if (
      target.providerId !== selection.providerId ||
      target.model !== selection.model ||
      (target.reasoningLevel !== undefined && target.reasoningLevel !== selection.reasoningLevel)
    )
      apply = {
        providerId: target.providerId,
        model: target.model,
        ...(target.reasoningLevel ? { reasoningLevel: target.reasoningLevel } : {}),
      };
  } else if (selection.providerId && getProviderRule(profile, selection.providerId)?.enabled === false) {
    const fallback = options.providers?.find((id) => getProviderRule(profile, id)?.enabled !== false);
    if (fallback) apply = { providerId: fallback };
    else if (options.providers === null) return { state };
  } else if (selection.providerId && !allows(profile, selection)) {
    // The current model is outside the provider's limit: take the first
    // model the profile keeps for it.
    const first = getProviderRule(profile, selection.providerId)?.modelIds[0];
    if (first) apply = { providerId: selection.providerId, model: first };
  }
  if (!apply && !selection.providerId) return { state };
  return {
    state: {
      project: projectId,
      userPicked: false,
      applied: apply
        ? { providerId: apply.providerId, model: apply.model }
        : { providerId: selection.providerId, model: selection.model },
    },
    ...(apply ? { apply } : {}),
  };
}
