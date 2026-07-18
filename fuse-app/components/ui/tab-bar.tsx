"use client";

// Bottom tab bar (U4). A client component because the active tab is derived from
// the live pathname. Each tab is a real Next <Link> — tapping it navigates to that
// route, so nothing here is a dead control (R17). The routes it points at exist as
// honest stage placeholders until their owning units fill them in.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, isActiveTab } from "@/lib/ui/shell";
import { TabIcon } from "@/components/ui/icons";

export default function TabBar() {
  const pathname = usePathname() ?? "/";

  return (
    <nav className="tabbar" aria-label="Primary">
      {TABS.map((tab) => {
        const active = isActiveTab(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? "tab active" : "tab"}
            aria-current={active ? "page" : undefined}
            data-testid={`tab-${tab.icon}`}
          >
            <TabIcon icon={tab.icon} className="tab-icon" />
            <span className="tab-label">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
