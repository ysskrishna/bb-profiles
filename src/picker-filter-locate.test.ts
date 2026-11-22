// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { locateQueryClient } from "./picker-filter";

const client = {
  defaultQueryOptions: (options: unknown) => options,
  getQueryCache: () => ({ getAll: () => [], subscribe: () => () => {} }),
};
function withFiber(element: HTMLElement, fiber: unknown) {
  Object.defineProperty(element, "__reactFiber$test", { value: fiber, enumerable: true });
}

describe("locating BB's query client", () => {
  it("walks up the fiber chain to a provider value", () => {
    const element = document.createElement("div");
    const root = { memoizedProps: { value: client }, return: null };
    withFiber(element, { memoizedProps: {}, return: { memoizedProps: { value: 3 }, return: root } });
    expect(locateQueryClient(element)).toBe(client);
  });
  it("accepts a client passed as a `client` prop", () => {
    const element = document.createElement("div");
    withFiber(element, { memoizedProps: { client }, return: null });
    expect(locateQueryClient(element)).toBe(client);
  });
  it("returns null without a fiber, without a client, or on a cyclic chain", () => {
    expect(locateQueryClient(document.createElement("div"))).toBeNull();
    const plain = document.createElement("div");
    withFiber(plain, { memoizedProps: { value: { defaultQueryOptions() {} } }, return: null });
    expect(locateQueryClient(plain)).toBeNull();
    const cyclic = document.createElement("div");
    const fiber: Record<string, unknown> = { memoizedProps: {} };
    fiber.return = fiber;
    withFiber(cyclic, fiber);
    expect(locateQueryClient(cyclic)).toBeNull();
  });
});
