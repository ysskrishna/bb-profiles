// The plugin's settings page. Every change saves on its own, as BB's own
// settings do; each section shows Saving.../Saved beside its title.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { CUSTOM_MODELS_CHANGED, PROFILES_CHANGED } from "./channels";
import type { rpcContract } from "./contract";
import { ProfilesSection, type ProfileActions } from "./ProfilesSection";
import { ProvidersSection } from "./ProvidersSection";
import { receiveSnapshot, reportSyncError, useProfilesView } from "../lib/profiles-client";
import { DEFAULT_PROFILE_ID, type Snapshot } from "./profiles";
import { useCatalogs, useProjects, useProviders, type CustomModelOption } from "../lib/settings-data";
import { SettingsSection, SettingsSelect, SettingRow, type SaveStatus } from "./settings-ui";
import { Button } from "../components/ui/button";

const SAVED_VISIBLE_MS = 2_000;
type Section = "profiles" | "providers" | "everywhere";

function errorDetail(error: unknown): string {
  return (error instanceof Error && error.message.replace(/^HTTP \d+: /, "").trim()) || "Unknown error";
}

export function SettingsPage() {
  const rpc = useRpc<typeof rpcContract>();
  const view = useProfilesView();
  const { providers } = useProviders();
  const projects = useProjects();
  const [catalogVersion, setCatalogVersion] = useState(0);
  const catalogs = useCatalogs(
    providers.map((p) => p.id),
    catalogVersion,
  );
  const [customModels, setCustomModels] = useState<CustomModelOption[]>([]);
  const [customWarning, setCustomWarning] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(DEFAULT_PROFILE_ID);
  const [feedback, setFeedback] = useState<{
    section: Section;
    status: SaveStatus;
  } | null>(null);
  const [failure, setFailure] = useState<{
    section: Section;
    message: string;
  } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const snapshot = view.snapshot;
  const latest = useRef<Snapshot | null>(null);
  latest.current = snapshot;
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const load = useCallback(() => {
    rpc.call("getSnapshot", null).then(receiveSnapshot, reportSyncError);
  }, [rpc]);
  useEffect(load, [load]);
  useRealtime(PROFILES_CHANGED, load);

  const loadCustomModels = useCallback(
    (refreshCatalogs: boolean) => {
      rpc.call("listCustomModels", null).then(
        (result) => {
          setCustomModels(result.models);
          if (refreshCatalogs) setCatalogVersion((v) => v + 1);
        },
        () => {},
      );
    },
    [rpc],
  );
  useEffect(() => loadCustomModels(false), [loadCustomModels]);
  useRealtime(CUSTOM_MODELS_CHANGED, () => loadCustomModels(true));

  useEffect(() => {
    if (feedback?.status !== "saved") return;
    const timer = setTimeout(() => setFeedback((now) => (now === feedback ? null : now)), SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  /** Run changes one after another so a quick second edit builds on the first. */
  const save = useCallback(
    <T,>(
      section: Section,
      run: (current: Snapshot) => Promise<{ snapshot: Snapshot; value: T }>,
    ): Promise<T | undefined> => {
      const task = queue.current.then(async () => {
        setFeedback({ section, status: "saving" });
        setFailure(null);
        try {
          const done = await run(latest.current as Snapshot);
          latest.current = done.snapshot;
          receiveSnapshot(done.snapshot);
          setFeedback({ section, status: "saved" });
          return done.value;
        } catch (error) {
          setFeedback({ section, status: "error" });
          setFailure({ section, message: errorDetail(error) });
          return undefined;
        }
      });
      queue.current = task;
      return task;
    },
    [],
  );
  const plain = (snap: Promise<Snapshot>) => snap.then((s) => ({ snapshot: s, value: true }));

  if (snapshot === null) {
    return (
      <div className="max-w-3xl rounded-lg border border-border px-4 py-8 text-center text-sm text-muted-foreground">
        {view.error === null ? "Loading settings..." : `Could not load settings: ${view.error}`}
      </div>
    );
  }

  const selected = snapshot.profiles.find((p) => p.id === selectedId) ?? snapshot.profiles[0];
  const statusFor = (section: Section) => (feedback?.section === section ? feedback.status : undefined);
  const errorFor = (section: Section) => (failure?.section === section ? failure.message : null);

  const actions: ProfileActions = {
    create: async (name, copyFromId) => {
      const id = await save("profiles", async () => {
        const created = await rpc.call("createProfile", { name, copyFromId });
        return { snapshot: created.snapshot, value: created.id };
      });
      if (id) setSelectedId(id);
      return id !== undefined;
    },
    rename: async (id, name) => (await save("profiles", () => plain(rpc.call("renameProfile", { id, name })))) === true,
    remove: async (id) => {
      const ok = await save("profiles", () => plain(rpc.call("deleteProfile", { id })));
      if (ok) setSelectedId(DEFAULT_PROFILE_ID);
      return ok === true;
    },
    setProjects: (id, projectIds) =>
      void save("profiles", () => plain(rpc.call("setProfileProjects", { id, projectIds }))),
    setDefaultModel: (profileId, defaultModel) =>
      void save("profiles", () => plain(rpc.call("setDefaultModel", { profileId, defaultModel }))),
  };

  const addCustomModel = async (providerId: string, model: string, displayName: string | undefined) => {
    setCustomWarning(null);
    const done = await save("providers", async (current) => {
      const added = await rpc.call("addCustomModel", {
        providerId,
        model,
        // An absent name must be left out: undefined is not a JSON value.
        ...(displayName ? { displayName } : {}),
      });
      setCustomModels(added.models);
      setCatalogVersion((v) => v + 1);
      setCustomWarning(added.warning ?? null);
      const rule = current.profiles.find((p) => p.id === selected.id)?.providers[providerId];
      if (!rule?.limit) return { snapshot: current, value: true };
      const snapshot = await rpc.call("setProvider", {
        profileId: selected.id,
        providerId,
        rule: { ...rule, modelIds: [...new Set([...rule.modelIds, model])] },
      });
      return { snapshot, value: true };
    });
    return done === true;
  };
  const removeCustomModel = async (providerId: string, model: string) => {
    setCustomWarning(null);
    await save("providers", async (current) => {
      const removed = await rpc.call("removeCustomModel", {
        providerId,
        model,
      });
      setCustomModels(removed.models);
      setCatalogVersion((v) => v + 1);
      setCustomWarning(removed.warning ?? null);
      return { snapshot: current, value: true };
    });
  };

  return (
    <div className="max-w-3xl space-y-6 pb-4">
      {view.runtime.state === "unsupported" ? (
        <p role="alert" className="text-xs text-destructive">
          {view.runtime.message}
        </p>
      ) : null}
      <ProfilesSection
        snapshot={snapshot}
        selected={selected}
        onSelect={setSelectedId}
        projects={projects}
        providers={providers}
        catalogs={catalogs}
        status={statusFor("profiles")}
        error={errorFor("profiles")}
        actions={actions}
      />
      <ProvidersSection
        key={selected.id}
        profile={selected}
        providers={providers}
        catalogs={catalogs}
        status={statusFor("providers")}
        error={errorFor("providers")}
        customModels={customModels}
        customWarning={customWarning}
        onAddCustomModel={addCustomModel}
        onRemoveCustomModel={removeCustomModel}
        onChange={(providerId, update) =>
          void save("providers", (current) => {
            const profile = current.profiles.find((p) => p.id === selected.id);
            const base = profile?.providers[providerId] ?? {
              enabled: true,
              limit: false,
              modelIds: [],
            };
            return plain(
              rpc.call("setProvider", {
                profileId: selected.id,
                providerId,
                rule: update(base),
              }),
            );
          })
        }
      />
      <div>
        <SettingsSection title="Everywhere" status={statusFor("everywhere")}>
          {errorFor("everywhere") ? (
            <p role="alert" className="px-4 py-2 text-xs text-destructive">
              {errorFor("everywhere")}
            </p>
          ) : null}
          <SettingRow
            title="Hidden models"
            description="Unselected models can stay reachable in the picker."
            control={
              <SettingsSelect
                aria-label="Hidden models"
                className="w-52"
                value={snapshot.hiddenModels}
                onChange={(event) => {
                  const mode = event.target.value === "remove" ? "remove" : "more";
                  void save("everywhere", () => plain(rpc.call("setHiddenModels", { mode })));
                }}
              >
                <option value="more">Show under More models</option>
                <option value="remove">Remove from the picker</option>
              </SettingsSelect>
            }
          />
        </SettingsSection>
        <div className="mt-2 px-1 text-xs text-muted-foreground">
          {confirmReset ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              Remove every profile and rule?
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={async () => {
                  setConfirmReset(false);
                  setSelectedId(DEFAULT_PROFILE_ID);
                  await save("everywhere", () => plain(rpc.call("reset", null)));
                }}
              >
                Reset
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="underline-offset-2 hover:text-foreground hover:underline"
            >
              Reset everything
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
