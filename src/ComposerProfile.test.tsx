// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { limit, profile, snapshotOf } from "./test-utils";

const state = vi.hoisted(() => ({
  composer: {} as Record<string, unknown>,
  setSelection: vi.fn(),
  sdk: {
    providers: {
      list: async () => [
        { id: "codex", available: true },
        { id: "claude", available: true },
      ],
    },
  },
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useComposer: () => state.composer,
  useSdk: () => state.sdk,
  experimental_Icon: () => null,
}));
import { ComposerProfile } from "./ComposerProfile";
import { receiveSnapshot, useProfilesView } from "../lib/profiles-client";

let n = 0;
function composer(selection: Record<string, string>, key: string, extra = {}) {
  state.composer = {
    key,
    selection,
    isEmpty: true,
    isSubmitting: false,
    setSelection: state.setSelection,
    ...extra,
  };
}
function Project() {
  return <output data-testid="project">{String(useProfilesView().composerProjectId)}</output>;
}
const snapshot = (revision: number) =>
  snapshotOf(
    { claude: limit("opus") },
    {
      revision,
      defaultModel: { providerId: "codex", model: "gpt" },
      others: [
        profile(
          "work",
          {},
          {
            projectIds: ["p1"],
            defaultModel: {
              providerId: "claude",
              model: "opus",
              reasoningLevel: "high",
            },
          },
        ),
      ],
    },
  );
beforeEach(() => {
  n += 1;
  state.setSelection.mockReset().mockImplementation(async (s: Record<string, string>) => s);
  receiveSnapshot(snapshot(1000 + n));
});
afterEach(cleanup);

describe("ComposerProfile", () => {
  it("applies the project's default without a fast tier, then stops after a user pick", async () => {
    composer({ projectId: "p1", providerId: "codex", model: "x" }, `draft-${n}`);
    const view = render(
      <>
        <ComposerProfile />
        <Project />
      </>,
    );
    await waitFor(() => expect(state.setSelection).toHaveBeenCalledTimes(1));
    expect(state.setSelection).toHaveBeenCalledWith({
      providerId: "claude",
      model: "opus",
      reasoningLevel: "high",
      serviceTier: "default",
    });
    expect(screen.getByTestId("project").textContent).toBe("p1");
    composer(
      {
        projectId: "p1",
        providerId: "claude",
        model: "opus",
        reasoningLevel: "high",
      },
      `draft-${n}`,
    );
    view.rerender(
      <>
        <ComposerProfile />
        <Project />
      </>,
    );
    composer({ projectId: "p1", providerId: "codex", model: "terra" }, `draft-${n}`);
    view.rerender(
      <>
        <ComposerProfile />
        <Project />
      </>,
    );
    composer({ projectId: "p2", providerId: "codex", model: "terra" }, `draft-${n}`);
    view.rerender(
      <>
        <ComposerProfile />
        <Project />
      </>,
    );
    await act(async () => {});
    expect(state.setSelection).toHaveBeenCalledTimes(1);
    view.unmount();
  });
  it("re-applies on a project change and clears the project on unmount", async () => {
    composer(
      {
        projectId: "p1",
        providerId: "claude",
        model: "opus",
        reasoningLevel: "high",
      },
      `draft-${n}`,
    );
    const view = render(
      <>
        <ComposerProfile />
        <Project />
      </>,
    );
    await act(async () => {});
    expect(state.setSelection).not.toHaveBeenCalled();
    composer({ projectId: "p2", providerId: "claude", model: "opus" }, `draft-${n}`);
    view.rerender(
      <>
        <ComposerProfile />
        <Project />
      </>,
    );
    await waitFor(() => expect(state.setSelection).toHaveBeenCalledTimes(1));
    expect(state.setSelection.mock.calls[0][0]).toMatchObject({
      providerId: "codex",
      model: "gpt",
      serviceTier: "default",
    });
    view.unmount();
    render(<Project />);
    expect(screen.getByTestId("project").textContent).toBe("null");
  });
  it("skips while submitting", async () => {
    composer({ projectId: "p1", providerId: "codex", model: "x" }, `draft-${n}`, { isSubmitting: true });
    render(<ComposerProfile />);
    await act(async () => {});
    expect(state.setSelection).not.toHaveBeenCalled();
  });
  it("opens the plugin settings route from the gear button", () => {
    composer(
      {
        projectId: "p1",
        providerId: "claude",
        model: "opus",
        reasoningLevel: "high",
      },
      `draft-${n}`,
    );
    const popstate = vi.fn();
    window.addEventListener("popstate", popstate);
    render(<ComposerProfile />);
    fireEvent.click(screen.getByRole("button", { name: "Profiles settings" }));
    expect(window.location.pathname).toBe("/settings/plugins/bb-profiles");
    expect(window.location.search).toBe("?tab=settings");
    expect(popstate).toHaveBeenCalled();
    window.removeEventListener("popstate", popstate);
  });
});
