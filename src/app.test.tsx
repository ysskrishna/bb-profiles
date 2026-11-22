// @vitest-environment jsdom
import React, { type ComponentType } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Snapshot } from "./profiles";
import { receiveSnapshot, reportRuntime, setComposerProject, useProfilesView } from "../lib/profiles-client";
import type { PickerState } from "./picker-filter";
import { limit, snapshotOf } from "./test-utils";

type Bridge = {
  update: Mock<(state: PickerState) => void>;
  dispose: Mock<() => void>;
};
type Registration = { component: ComponentType };
const state = vi.hoisted(() => ({
  connection: "connecting",
  overlay: null as ComponentType | null,
  snapshot: null as unknown,
  rpc: { call: vi.fn<(...args: unknown[]) => Promise<unknown>>() },
  sdk: {
    environments: {
      list: vi.fn<(args: unknown) => Promise<unknown[]>>(),
    },
  },
  listeners: new Map<string, Set<() => void>>(),
  client: {},
  bridges: [] as unknown[],
  attach: vi.fn(),
  find: vi.fn(),
}));

vi.mock("@get-bb/plugin-sdk/app", () => ({
  definePluginApp: (
    setup: (app: {
      composer: { customize: () => void };
      slots: {
        experimental_appOverlay: (registration: Registration) => void;
        settingsSection: () => void;
      };
    }) => void,
  ) => {
    setup({
      composer: { customize: () => {} },
      slots: {
        experimental_appOverlay: ({ component }) => {
          state.overlay = component;
        },
        settingsSection: () => {},
      },
    });
    return {};
  },
  useRpc: () => state.rpc,
  useSdk: () => state.sdk,
  useRealtimeConnectionState: () => state.connection,
  useRealtime: (channel: string, handler: () => void) => {
    React.useEffect(() => {
      const listeners = state.listeners.get(channel) ?? new Set<() => void>();
      state.listeners.set(channel, listeners);
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    }, [channel, handler]);
  },
}));
vi.mock("./picker-filter", () => ({
  locateQueryClient: () => state.find(),
  installPickerFilter: (...args: unknown[]) => state.attach(...args),
}));
vi.mock("./SettingsPage", () => ({ SettingsPage: () => null }));
vi.mock("./ComposerProfile", () => ({ ComposerProfile: () => null }));
import "../app";

function Surface() {
  const Overlay = state.overlay!;
  const view = useProfilesView();
  return (
    <>
      <Overlay />
      <output data-testid="snapshot">{JSON.stringify(view.snapshot)}</output>
      <output data-testid="runtime">{view.runtime.state}</output>
    </>
  );
}
function snapshot(revision: number, model = "selected-model"): Snapshot {
  return snapshotOf({ custom: limit(model) }, { revision });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const readSnapshot = () => JSON.parse(screen.getByTestId("snapshot").textContent!);
const bridges = () => state.bridges as Bridge[];
let baseRevision = 0;
beforeEach(() => {
  baseRevision += 100;
  state.connection = "connecting";
  state.find.mockReset().mockReturnValue(state.client);
  state.snapshot = snapshot(baseRevision + 1);
  state.listeners.clear();
  state.bridges.length = 0;
  state.rpc.call.mockReset().mockImplementation(async () => state.snapshot);
  state.sdk.environments.list.mockReset().mockResolvedValue([]);
  state.attach.mockReset().mockImplementation(() => {
    const bridge = {
      update: vi.fn<(value: PickerState) => void>(),
      dispose: vi.fn<() => void>(),
    };
    state.bridges.push(bridge);
    return bridge;
  });
  receiveSnapshot(snapshotOf({}, { revision: baseRevision }));
  setComposerProject(null);
  reportRuntime({ state: "starting", message: "Connecting" });
});
afterEach(cleanup);

describe("frontend profile synchronization", () => {
  it("recovers a missed server update on reconnect without a realtime signal", async () => {
    const surface = render(<Surface />);
    await waitFor(() => expect(readSnapshot()).toEqual(state.snapshot));
    state.connection = "connected";
    surface.rerender(<Surface />);
    state.connection = "reconnecting";
    surface.rerender(<Surface />);
    state.snapshot = snapshot(baseRevision + 2, "changed-on-another-client");
    state.connection = "connected";
    surface.rerender(<Surface />);
    await waitFor(() => expect(readSnapshot()).toEqual(state.snapshot));
    expect(bridges()[0].update).toHaveBeenLastCalledWith(expect.objectContaining({ snapshot: state.snapshot }));
  });

  it("keeps the newest snapshot when a slower bootstrap response arrives after a realtime refresh", async () => {
    const bootstrap = deferred<Snapshot>();
    const realtime = deferred<Snapshot>();
    state.rpc.call.mockReset().mockReturnValueOnce(bootstrap.promise).mockReturnValueOnce(realtime.promise);
    render(<Surface />);
    act(() => {
      for (const listener of state.listeners.get("profiles-changed") ?? []) listener();
    });
    const newest = snapshot(baseRevision + 2, "latest");
    await act(async () => {
      realtime.resolve(newest);
    });
    await waitFor(() => expect(readSnapshot()).toEqual(newest));
    const stale = snapshot(baseRevision + 1, "stale");
    await act(async () => {
      bootstrap.resolve(stale);
    });
    expect(readSnapshot()).toEqual(newest);
    expect(bridges()[0].update).not.toHaveBeenCalledWith(expect.objectContaining({ snapshot: stale }));
  });

  it("attaches once, feeds composer project and environment map changes, and disposes on unmount", async () => {
    state.sdk.environments.list.mockResolvedValue([
      { id: "env1", projectId: "p1" },
      { id: "env2", projectId: null },
    ]);
    const surface = render(<Surface />);
    await waitFor(() =>
      expect(bridges()[0].update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          environmentProjects: { env1: "p1", env2: null },
        }),
      ),
    );
    expect(screen.getByTestId("runtime").textContent).toBe("active");
    act(() => setComposerProject("p9"));
    expect(bridges()[0].update).toHaveBeenLastCalledWith(expect.objectContaining({ composerProjectId: "p9" }));
    expect(state.attach).toHaveBeenCalledTimes(1);
    surface.unmount();
    expect(bridges()[0].dispose).toHaveBeenCalledTimes(1);
    expect(state.listeners.get("profiles-changed")?.size).toBe(0);
  });

  it("looks an unknown environment up once", async () => {
    render(<Surface />);
    await waitFor(() => expect(state.attach).toHaveBeenCalled());
    await waitFor(() => expect(state.sdk.environments.list).toHaveBeenCalled());
    const onUnknown = state.attach.mock.calls[0][2] as (id: string) => void;
    const before = state.sdk.environments.list.mock.calls.length;
    await act(async () => {
      onUnknown("env-new");
      onUnknown("env-new");
    });
    await waitFor(() => expect(state.sdk.environments.list.mock.calls.length).toBe(before + 1));
    await act(async () => {
      onUnknown("env-new");
    });
    expect(state.sdk.environments.list.mock.calls.length).toBe(before + 1);
  });

  it("keeps discovery failures inside the inactive status boundary", async () => {
    state.find.mockImplementation(() => {
      throw new Error("Unsupported query client");
    });
    render(<Surface />);
    await waitFor(() => expect(screen.getByTestId("runtime").textContent).toBe("unsupported"));
    expect(state.attach).not.toHaveBeenCalled();
  });
});
