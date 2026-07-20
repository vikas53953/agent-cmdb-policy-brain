// Interaction tests for the Playlists pane — the F-2 "two clicks" class.
//
// THE BUG CLASS THESE EXIST TO CATCH: a control that silently discards the user's
// FIRST click. Three unrelated controls showed it (Create, delete, mini-player play),
// so the question these tests answer is not "does Create work?" but "does ONE click
// do the job?". Every assertion below counts clicks, because that is the thing that
// was broken.

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlaylistDTO } from "@/lib/library/dto";

// The server actions are mocked: these tests are about the CLICK reaching the write,
// not about the database. Each mock records how many times it was actually called.
const createPlaylistAction = vi.fn();
const renamePlaylistAction = vi.fn();
const deletePlaylistAction = vi.fn();
const removeTrackFromPlaylistAction = vi.fn();
const reorderPlaylistTracksAction = vi.fn();

vi.mock("@/lib/library-actions", () => ({
  createPlaylistAction: (...args: unknown[]) => createPlaylistAction(...args),
  renamePlaylistAction: (...args: unknown[]) => renamePlaylistAction(...args),
  deletePlaylistAction: (...args: unknown[]) => deletePlaylistAction(...args),
  removeTrackFromPlaylistAction: (...args: unknown[]) =>
    removeTrackFromPlaylistAction(...args),
  reorderPlaylistTracksAction: (...args: unknown[]) =>
    reorderPlaylistTracksAction(...args),
}));

// The track row pulls the whole player runtime in; this pane's behaviour does not
// depend on it, so it is stubbed to keep these tests about the pane.
vi.mock("@/components/library/track-row", () => ({
  default: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div>,
}));

import PlaylistsPane from "@/components/library/playlists-pane";

function playlist(name: string, id = name): PlaylistDTO {
  return { id, name, tracks: [] } as unknown as PlaylistDTO;
}

beforeEach(() => {
  vi.clearAllMocks();
  createPlaylistAction.mockImplementation(async (name: string) => playlist(name));
  deletePlaylistAction.mockResolvedValue(true);
  renamePlaylistAction.mockImplementation(async (id: string, name: string) =>
    playlist(name, id),
  );
});

describe("F-2 — one click is enough", () => {
  test("Create: typing a name then ONE click creates the playlist", async () => {
    const user = userEvent.setup();
    render(<PlaylistsPane initial={[]} />);

    await user.type(screen.getByLabelText("New playlist name"), "Road trip");
    await user.click(screen.getByRole("button", { name: "Create playlist" }));

    // ONE call. If the first click is discarded this is 0.
    await waitFor(() => expect(createPlaylistAction).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Road trip")).toBeInTheDocument();
  });

  test("delete: ONE click on the trash icon deletes, even right after renaming", async () => {
    const user = userEvent.setup();
    render(<PlaylistsPane initial={[playlist("Road trip")]} />);

    // Enter rename mode, so the rename input holds focus. Clicking the trash icon now
    // fires the input's onBlur FIRST — the ordering that used to disable the trash
    // button mid-click and swallow the tap.
    await user.click(screen.getByRole("button", { name: "Rename Road trip" }));
    const input = await screen.findByRole("textbox", { name: "Rename Road trip" });
    await user.type(input, " 2");

    await user.click(screen.getByRole("button", { name: "Delete Road trip" }));

    // The confirmation step (F-3) stands between the click and the delete.
    await user.click(await screen.findByRole("button", { name: "Delete playlist" }));

    await waitFor(() => expect(deletePlaylistAction).toHaveBeenCalledTimes(1));
  });
});

describe("F-3 — deleting asks first", () => {
  test("the trash icon alone never deletes; it asks", async () => {
    const user = userEvent.setup();
    render(<PlaylistsPane initial={[playlist("Road trip")]} />);

    await user.click(screen.getByRole("button", { name: "Delete Road trip" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // Nothing has been deleted yet — asking is not doing.
    expect(deletePlaylistAction).not.toHaveBeenCalled();
    expect(screen.getByText("Road trip")).toBeInTheDocument();
  });

  test("Keep it backs out and the playlist survives", async () => {
    const user = userEvent.setup();
    render(<PlaylistsPane initial={[playlist("Road trip")]} />);

    await user.click(screen.getByRole("button", { name: "Delete Road trip" }));
    await user.click(await screen.findByRole("button", { name: "Keep it" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(deletePlaylistAction).not.toHaveBeenCalled();
    expect(screen.getByText("Road trip")).toBeInTheDocument();
  });

  test("the question names the playlist in plain words", async () => {
    const user = userEvent.setup();
    render(<PlaylistsPane initial={[playlist("Road trip")]} />);

    await user.click(screen.getByRole("button", { name: "Delete Road trip" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText(/Delete “Road trip”\?/)).toBeInTheDocument();
    // No dev-speak. The user is a network engineer who hates it.
    expect(dialog.textContent ?? "").not.toMatch(/confirm|destructive|irreversible/i);
  });

  test("confirming deletes exactly once", async () => {
    const user = userEvent.setup();
    render(<PlaylistsPane initial={[playlist("Road trip")]} />);

    await user.click(screen.getByRole("button", { name: "Delete Road trip" }));
    await user.click(await screen.findByRole("button", { name: "Delete playlist" }));

    await waitFor(() => expect(deletePlaylistAction).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByText("Road trip")).not.toBeInTheDocument(),
    );
  });
});

describe("F-8 — rename ends when you press Enter", () => {
  test("Enter leaves edit mode and shows the new name as text", async () => {
    const user = userEvent.setup();
    render(<PlaylistsPane initial={[playlist("Road trip")]} />);

    await user.click(screen.getByRole("button", { name: "Rename Road trip" }));
    const input = await screen.findByRole("textbox", { name: "Rename Road trip" });
    await user.clear(input);
    await user.type(input, "Long drive{Enter}");

    // The field is gone — not still sitting there looking editable.
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: /^Rename / }),
      ).not.toBeInTheDocument(),
    );
    expect(renamePlaylistAction).toHaveBeenCalledTimes(1);
  });

  test("Enter does not save the same name twice (blur must not re-fire it)", async () => {
    const user = userEvent.setup();
    render(<PlaylistsPane initial={[playlist("Road trip")]} />);

    await user.click(screen.getByRole("button", { name: "Rename Road trip" }));
    const input = await screen.findByRole("textbox", { name: "Rename Road trip" });
    await user.clear(input);
    await user.type(input, "Long drive{Enter}");

    await waitFor(() => expect(renamePlaylistAction).toHaveBeenCalledTimes(1));
  });
});
