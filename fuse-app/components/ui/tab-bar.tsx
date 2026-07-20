"use client";

// Bottom tab bar (U4, F-5). A client component because the active tab is derived from
// the live pathname. Each tab is a real Next <Link> — tapping it navigates to that
// route, so nothing here is a dead control (R17). All four routes are real, finished
// screens — Home, Search, DJ, and Library.
//
// F-5: every tab route is `force-dynamic`, so a tap is a real server round-trip and the
// OUTGOING screen stays on display for the whole of it. `useLinkStatus` reports that
// link's pending state on the first frame, with no round-trip of its own, so the tapped
// tab can acknowledge the tap immediately. The same flag is pushed into the shared
// nav-pending store, which lets the app shell step the outgoing screen back so it can
// never be mistaken for the screen the user asked for. Full reasoning lives in
// lib/ui/nav-pending.ts.

import { useEffect, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { TABS, isActiveTab, type TabDef } from "@/lib/ui/shell";
import { setNavPending } from "@/lib/ui/nav-pending";
import { TabIcon } from "@/components/ui/icons";

// The inside of one tab. This MUST be its own component rendered as a CHILD of <Link>:
// that is the only place `useLinkStatus` can read the enclosing link's state from.
function TabContents({
  tab,
  active,
  onPendingChange,
}: {
  tab: TabDef;
  active: boolean;
  onPendingChange: (pending: boolean) => void;
}) {
  const { pending } = useLinkStatus();

  // Publish this link's pending state twice: UP to the enclosing <Link> (so the styling
  // can hang off the tab element itself) and OUT to the shell's shared store. Both are
  // retracted on unmount so a tab that disappears mid-navigation cannot leave the app
  // stuck looking like it is still moving.
  useEffect(() => {
    onPendingChange(pending);
    setNavPending(tab.href, pending);
    return () => {
      onPendingChange(false);
      setNavPending(tab.href, false);
    };
  }, [tab.href, pending, onPendingChange]);

  return (
    <>
      <TabIcon icon={tab.icon} className="tab-icon" />
      <span className="tab-label">{tab.label}</span>
      {/* Screen-reader parity: a sighted user sees the tab light up the moment they tap,
          so a screen-reader user is told the same thing, in the same plain words. */}
      {pending && !active ? (
        <span className="sr-only" role="status">
          Opening {tab.label}
        </span>
      ) : null}
    </>
  );
}

// One tab. Split out so `data-pending` can be set on the <Link> itself from the child's
// status — the attribute the pending styling hangs off.
function Tab({ tab, active }: { tab: TabDef; active: boolean }) {
  const [pending, setPending] = useState(false);
  return (
    <Link
      href={tab.href}
      className={active ? "tab active" : "tab"}
      aria-current={active ? "page" : undefined}
      data-testid={`tab-${tab.icon}`}
      data-pending={pending ? "true" : undefined}
    >
      <TabContents tab={tab} active={active} onPendingChange={setPending} />
    </Link>
  );
}

export default function TabBar() {
  const pathname = usePathname() ?? "/";

  return (
    <nav className="tabbar" aria-label="Primary">
      {TABS.map((tab) => (
        <Tab key={tab.href} tab={tab} active={isActiveTab(pathname, tab.href)} />
      ))}
    </nav>
  );
}
