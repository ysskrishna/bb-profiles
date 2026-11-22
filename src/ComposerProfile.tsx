import { useEffect, useState } from "react";
import { useComposer, useSdk } from "@get-bb/plugin-sdk/app";
import { Icon } from "../components/ui/icon";
import { planDefault, type DraftState } from "./composer-default";
import { setComposerProject, useProfilesView } from "../lib/profiles-client";

const PLUGIN_ID = "bb-profiles";
/** Per composer draft; outlives remounts of the component. */
const drafts = new Map<string, DraftState>();
const applying = new Set<string>();

function openSettings() {
  // BB has no supported way to open a plugin's settings from a composer, so
  // this pushes the settings route and tells the router about it.
  window.history.pushState(window.history.state, "", `/settings/plugins/${PLUGIN_ID}?tab=settings`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function ComposerProfile() {
  const composer = useComposer();
  const sdk = useSdk();
  const { snapshot } = useProfilesView();
  const [providers, setProviders] = useState<string[] | null>(null);
  const selection = composer.selection;
  const projectId = selection?.projectId ?? null;
  const key = composer.key;
  const submitting = composer.isSubmitting;

  useEffect(() => {
    setComposerProject(projectId);
    return () => setComposerProject(null);
  }, [projectId]);

  useEffect(() => {
    let live = true;
    sdk.providers.list().then(
      (rows) => {
        if (live) setProviders(rows.filter((p) => p.available).map((p) => p.id));
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [sdk]);

  const providerId = selection?.providerId;
  const model = selection?.model;
  const reasoningLevel = selection?.reasoningLevel;
  const draftEmpty = composer.isEmpty;
  useEffect(() => {
    if (!snapshot || !selection || submitting || applying.has(key)) return;
    const plan = planDefault(drafts.get(key), selection, snapshot, {
      draftEmpty,
      providers,
    });
    drafts.set(key, plan.state);
    const apply = plan.apply;
    if (!apply) return;
    applying.add(key);
    composer
      .setSelection({
        providerId: apply.providerId,
        ...(apply.model ? { model: apply.model } : {}),
        ...(apply.reasoningLevel ? { reasoningLevel: apply.reasoningLevel as never } : {}),
        serviceTier: "default",
      })
      .then(
        (result) => {
          const state = drafts.get(key);
          if (state)
            drafts.set(key, {
              ...state,
              applied: { providerId: result.providerId, model: result.model },
            });
        },
        () => {},
      )
      .finally(() => applying.delete(key));
    // The composer object changes identity per render; the fields below are
    // the inputs of the decision.
  }, [snapshot, projectId, providerId, model, reasoningLevel, providers, key, draftEmpty, submitting]);

  return (
    <button
      type="button"
      aria-label="Profiles settings"
      title="Profiles settings"
      onClick={openSettings}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Icon name="SlidersHorizontal" aria-hidden className="size-4" />
    </button>
  );
}
