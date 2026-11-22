import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { definePluginApp, useRealtime, useRealtimeConnectionState, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { PROFILES_CHANGED } from "./src/channels";
import type { rpcContract } from "./src/contract";
import { installPickerFilter, locateQueryClient } from "./src/picker-filter";
import {
  currentSnapshot,
  receiveEnvironmentProjects,
  receiveSnapshot,
  reportRuntime,
  reportSyncError,
  useProfilesView,
} from "./lib/profiles-client";
import { ComposerProfile } from "./src/ComposerProfile";
import { SettingsPage } from "./src/SettingsPage";

const ENVIRONMENT_PAGE = 200;
const ENVIRONMENT_CAP = 5000;

function RuntimeBootstrap() {
  const anchor = useRef<HTMLDivElement>(null);
  const bridge = useRef<ReturnType<typeof installPickerFilter> | null>(null);
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const connection = useRealtimeConnectionState();
  const view = useProfilesView();
  const refresh = useCallback(() => {
    rpc.call("getSnapshot", null).then(receiveSnapshot, reportSyncError);
  }, [rpc]);
  useRealtime(PROFILES_CHANGED, refresh);
  useEffect(() => {
    if (connection === "connected") refresh();
  }, [connection, refresh]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // environment id -> project id. Ids that the list did not contain are asked
  // for once; the map is rebuilt from the full list each time.
  const asked = useRef(new Set<string>());
  const loading = useRef(false);
  const loadEnvironments = useCallback(
    async (unknownId?: string) => {
      if (unknownId) {
        if (asked.current.has(unknownId)) return;
        asked.current.add(unknownId);
      }
      if (loading.current) return;
      loading.current = true;
      try {
        const map: Record<string, string | null> = {};
        for (let offset = 0; offset < ENVIRONMENT_CAP; offset += ENVIRONMENT_PAGE) {
          const rows = await sdk.environments.list({
            limit: ENVIRONMENT_PAGE,
            offset,
          });
          for (const row of rows) map[row.id] = row.projectId ?? null;
          if (rows.length < ENVIRONMENT_PAGE) break;
        }
        receiveEnvironmentProjects(map);
      } catch {
        // Unknown environments keep using the Default profile.
      } finally {
        loading.current = false;
      }
    },
    [sdk],
  );
  useEffect(() => {
    void loadEnvironments();
  }, [loadEnvironments]);

  const loadRef = useRef(loadEnvironments);
  loadRef.current = loadEnvironments;
  useLayoutEffect(() => {
    try {
      const client = anchor.current ? locateQueryClient(anchor.current) : null;
      if (!client) {
        reportRuntime({
          state: "unsupported",
          message: "This BB client is not compatible with Profiles. Native model lists are unchanged.",
        });
        return;
      }
      const state = {
        snapshot: currentSnapshot(),
        environmentProjects: view.environmentProjects,
        composerProjectId: view.composerProjectId,
      };
      bridge.current = installPickerFilter(client, state, (id) => void loadRef.current(id));
      reportRuntime({
        state: "active",
        message: "Profiles are connected in this BB window.",
      });
    } catch (error) {
      reportRuntime({
        state: "unsupported",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return () => {
      bridge.current?.dispose();
      bridge.current = null;
    };
    // Attach once; later changes go through update() below.
  }, []);
  useLayoutEffect(() => {
    if (view.snapshot)
      bridge.current?.update({
        snapshot: view.snapshot,
        environmentProjects: view.environmentProjects,
        composerProjectId: view.composerProjectId,
      });
  }, [view.snapshot, view.environmentProjects, view.composerProjectId]);
  return <div ref={anchor} hidden data-profiles-runtime="true" />;
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "profiles",
    scopes: ["new-thread"],
    actions: [{ id: "profile", component: ComposerProfile }],
  });
  app.slots.experimental_appOverlay({
    id: "runtime",
    component: RuntimeBootstrap,
  });
  app.slots.settingsSection({ id: "settings", component: SettingsPage });
});
