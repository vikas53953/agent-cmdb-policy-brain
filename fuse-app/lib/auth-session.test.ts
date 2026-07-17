import { describe, it, expect, vi, beforeEach } from "vitest";

// requireUser()/getUser() are thin readers over Auth.js `auth()` plus a redirect on
// the require path. Mock both dependencies so the helper's logic is tested in isolation
// with no NextAuth runtime and no database.
const authMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));

// redirect() throws NEXT_REDIRECT in real Next; model that with a tagged throw so we
// can assert the target path without a Next runtime.
class RedirectSignal extends Error {
  constructor(public path: string) {
    super(`REDIRECT:${path}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new RedirectSignal(path);
  },
}));

import { requireUser, getUser, SIGN_IN_PATH } from "./auth-session";

beforeEach(() => {
  authMock.mockReset();
});

describe("requireUser", () => {
  it("returns the user for a valid session", async () => {
    authMock.mockResolvedValue({
      user: { id: "u1", email: "listener@example.com", name: "Listener", image: "https://x/p.png" },
    });
    const user = await requireUser();
    expect(user).toEqual({
      id: "u1",
      email: "listener@example.com",
      name: "Listener",
      image: "https://x/p.png",
    });
  });

  it("redirects to sign-in when there is no session", async () => {
    authMock.mockResolvedValue(null);
    await expect(requireUser()).rejects.toMatchObject({ path: SIGN_IN_PATH });
  });

  it("redirects when the session user has no id", async () => {
    authMock.mockResolvedValue({ user: { email: "listener@example.com" } });
    await expect(requireUser()).rejects.toMatchObject({ path: SIGN_IN_PATH });
  });

  it("normalises missing optional fields to null", async () => {
    authMock.mockResolvedValue({ user: { id: "u2" } });
    expect(await requireUser()).toEqual({ id: "u2", email: null, name: null, image: null });
  });
});

describe("getUser", () => {
  it("returns null instead of redirecting when unauthenticated", async () => {
    authMock.mockResolvedValue(null);
    expect(await getUser()).toBeNull();
  });

  it("returns the user when authenticated", async () => {
    authMock.mockResolvedValue({ user: { id: "u3", email: null, name: null } });
    expect(await getUser()).toEqual({ id: "u3", email: null, name: null, image: null });
  });
});
