import { useSyncExternalStore } from "react";
import { INITIAL_SNAPSHOT, type Snapshot } from "../src/profiles";

type RuntimeStatus = {
  state: "starting" | "active" | "unsupported";
  message: string;
};
type View = {
  snapshot: Snapshot | null;
  error: string | null;
  runtime: RuntimeStatus;
  /** environment id -> project id, from sdk.environments.list. */
  environmentProjects: Readonly<Record<string, string | null>>;
  /** Project of the mounted new-thread composer, if any. */
  composerProjectId: string | null;
};
let view: View = {
  snapshot: null,
  error: null,
  runtime: { state: "starting", message: "Connecting to BB..." },
  environmentProjects: {},
  composerProjectId: null,
};
const listeners = new Set<() => void>();
function publish(next: View) {
  view = next;
  for (const listener of listeners) listener();
}
export function receiveSnapshot(snapshot: Snapshot) {
  if (view.snapshot && snapshot.revision < view.snapshot.revision) return;
  if (view.snapshot?.revision === snapshot.revision && !view.error) return;
  publish({ ...view, snapshot, error: null });
}
export function reportSyncError(error: unknown) {
  publish({
    ...view,
    error: error instanceof Error ? error.message : String(error),
  });
}
export function reportRuntime(runtime: RuntimeStatus) {
  publish({ ...view, runtime });
}
export function receiveEnvironmentProjects(environmentProjects: Readonly<Record<string, string | null>>) {
  publish({ ...view, environmentProjects });
}
export function setComposerProject(projectId: string | null) {
  if (view.composerProjectId === projectId) return;
  publish({ ...view, composerProjectId: projectId });
}
export function currentSnapshot(): Snapshot {
  return view.snapshot ?? INITIAL_SNAPSHOT;
}
export function useProfilesView() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => view,
  );
}
