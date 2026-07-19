"use client";

// Global keyboard shortcuts — a headless client component mounted once in the shell.
//
// Deliberately dumb. It describes the keydown, asks lib/player/shortcuts.ts whether the
// keystroke is ours and what it means, and applies the answer to the store. Every rule
// about typing, focused buttons, modifiers and open dialogs lives in that pure predicate,
// where it is unit-tested; nothing about "should we handle this?" is decided here.
//
// The listener is bound in the CAPTURE phase on `window`. Capture matters: it runs before
// a control's own bubbling handlers, which keeps the ordering predictable — but since the
// predicate refuses activation keys on focused controls, capturing never steals a key the
// focused element needed. The handler also only preventDefault()s keys it has actually
// claimed, so Space still scrolls when the player has nothing to say about it.

import { useEffect } from "react";
import { playerStore } from "@/lib/player/store";
import { applyShortcut, resolveShortcut, type KeyContext } from "@/lib/player/shortcuts";

// Roles that behave like a button for keyboard activation. A custom control built from a
// <div role="button"> owns Space exactly as a real <button> does.
const ACTIVATABLE_ROLES = new Set(["button", "link", "checkbox", "switch", "menuitem", "tab", "option", "radio"]);
const ACTIVATABLE_TAGS = new Set(["button", "a", "summary", "option"]);

// Translate the browser's event into the framework-free description the predicate reads.
// This is the one DOM-aware step, kept to pure field extraction so there is no judgement
// hiding in it.
export function describeKeyEvent(event: KeyboardEvent): KeyContext {
  const target = event.target;
  const element = target instanceof HTMLElement ? target : null;
  const tag = element ? element.tagName.toLowerCase() : "";
  const role = element?.getAttribute("role")?.toLowerCase() ?? "";
  return {
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    targetTag: tag,
    // `isContentEditable` covers a contenteditable host and everything nested inside it,
    // which a plain attribute check would miss.
    targetIsEditable:
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      element?.isContentEditable === true,
    targetIsActivatable: ACTIVATABLE_TAGS.has(tag) || ACTIVATABLE_ROLES.has(role),
  };
}

export default function KeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveShortcut(describeKeyEvent(event));
      if (!action) return;
      // Claimed: stop the browser doing its own thing with the key (Space scrolling the
      // page, arrows scrolling the track list) now that the player has answered it.
      event.preventDefault();
      applyShortcut(action, playerStore);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return null;
}
