import { describe, expect, it } from "vitest";
import {
  createPlayerHostCoordinator,
  type CoordinatorDoc,
} from "@/lib/player/host-coordinator";

// A DOM-free fake so the geometry coordinator runs under the node test env. Each element
// carries a settable bounding rect and a plain style bag, which is all positionHost reads.
type FakeEl = {
  id: string;
  className: string;
  style: Record<string, string>;
  parentElement: FakeEl | null;
  children: FakeEl[];
  rect: { top: number; left: number; width: number; height: number };
  appendChild(child: FakeEl): void;
  removeChild(child: FakeEl): void;
  setAttribute(name: string, value: string): void;
  getBoundingClientRect(): { top: number; left: number; width: number; height: number };
};

function fakeEl(rect = { top: 0, left: 0, width: 0, height: 0 }): FakeEl {
  const el: FakeEl = {
    id: "",
    className: "",
    style: {},
    parentElement: null,
    children: [],
    rect,
    appendChild(child) {
      if (child.parentElement) {
        child.parentElement.children = child.parentElement.children.filter((c) => c !== child);
      }
      child.parentElement = el;
      el.children.push(child);
    },
    removeChild(child) {
      el.children = el.children.filter((c) => c !== child);
      child.parentElement = null;
    },
    setAttribute() {},
    getBoundingClientRect() {
      return el.rect;
    },
  };
  return el;
}

function fakeDoc(): { doc: CoordinatorDoc; body: FakeEl } {
  const body = fakeEl();
  const doc = {
    createElement: () => fakeEl() as unknown as HTMLElement,
    body: body as unknown as HTMLElement,
  };
  return { doc, body };
}

// Build a coordinator wired to fakes with all browser seams stubbed out, and running in
// synchronous-sync mode (start() not called) so registerSlot measures immediately.
function setup() {
  const { doc, body } = fakeDoc();
  const coordinator = createPlayerHostCoordinator({
    doc,
    makeResizeObserver: () => null,
    addWindowListener: () => {},
    removeWindowListener: () => {},
    requestFrame: (cb) => {
      cb();
      return 0;
    },
    cancelFrame: () => {},
  });
  return { coordinator, body };
}

describe("player host coordinator — one host, positioned by geometry", () => {
  it("creates a single primary host parented to <body>, hidden until playback is live", () => {
    const { coordinator, body } = setup();
    const host = coordinator.primaryHost() as unknown as FakeEl;
    expect(host).not.toBeNull();
    expect(host.parentElement).toBe(body);
    expect(host.style.position).toBe("fixed");
    expect(host.style.display).toBe("none"); // nothing playing yet
    // Called again, it returns the SAME element — never a second host.
    expect(coordinator.primaryHost()).toBe(host as unknown as HTMLElement);
  });

  it("positions the host over the active slot by priority (np beats mini)", () => {
    const { coordinator } = setup();
    const host = coordinator.primaryHost() as unknown as FakeEl;
    coordinator.setPlaybackLive("primary", true);

    const mini = fakeEl({ top: 700, left: 10, width: 44, height: 44 });
    coordinator.registerSlot("mini", mini as unknown as HTMLElement);
    expect(coordinator.activeSlot()).toBe("mini");
    expect(host.style.display).toBe("block");
    expect(host.style.width).toBe("44px");
    expect(host.style.top).toBe("700px");

    // Opening Now Playing registers the np slot — it wins by priority.
    const np = fakeEl({ top: 80, left: 0, width: 360, height: 202 });
    coordinator.registerSlot("np", np as unknown as HTMLElement);
    expect(coordinator.activeSlot()).toBe("np");
    expect(host.style.width).toBe("360px");
    expect(host.style.top).toBe("80px");

    // Closing Now Playing releases the np slot — the host snaps back to the mini box.
    coordinator.releaseSlot("np", np as unknown as HTMLElement);
    expect(coordinator.activeSlot()).toBe("mini");
    expect(host.style.width).toBe("44px");
  });

  it("keeps a visible fallback chip when playback is live but no slot is on screen", () => {
    const { coordinator } = setup();
    const host = coordinator.primaryHost() as unknown as FakeEl;
    coordinator.setPlaybackLive("primary", true);
    // No slot registered at all.
    expect(host.style.display).toBe("block"); // never hidden while a track plays (ToS)
    expect(Number.parseInt(host.style.width, 10)).toBeGreaterThan(0);
  });

  it("hides the host entirely when nothing is playing and no slot is present", () => {
    const { coordinator } = setup();
    const host = coordinator.primaryHost() as unknown as FakeEl;
    coordinator.setPlaybackLive("primary", false);
    expect(host.style.display).toBe("none");
  });

  it("a zero-area slot is treated as no-slot so the player never shrinks to 0x0", () => {
    const { coordinator } = setup();
    const host = coordinator.primaryHost() as unknown as FakeEl;
    coordinator.setPlaybackLive("primary", true);
    const collapsing = fakeEl({ top: 0, left: 0, width: 0, height: 0 });
    coordinator.registerSlot("mini", collapsing as unknown as HTMLElement);
    // Falls through to the visible fallback chip rather than a hidden 0x0 player.
    expect(host.style.display).toBe("block");
    expect(Number.parseInt(host.style.width, 10)).toBeGreaterThan(0);
  });

  it("promoteIncoming swaps which element is primary WITHOUT re-parenting either", () => {
    const { coordinator } = setup();
    const primaryBefore = coordinator.primaryHost();
    const incomingBefore = coordinator.incomingHost();
    expect(primaryBefore).not.toBe(incomingBefore);

    coordinator.promoteIncoming();

    // The element that held the incoming (still-playing) iframe is now primary; the old
    // primary is now the reusable incoming host. Neither was detached/re-inserted.
    expect(coordinator.primaryHost()).toBe(incomingBefore);
    expect(coordinator.incomingHost()).toBe(primaryBefore);
    const p = primaryBefore as unknown as FakeEl;
    const i = incomingBefore as unknown as FakeEl;
    expect(p.parentElement).not.toBeNull(); // still in the DOM
    expect(i.parentElement).not.toBeNull();
  });
});
