import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { primaryNavItems } from "@/app/nav";
import styles from "@/app/AppShell.module.css";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Primary navigation">
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            P
          </span>
          <span className={styles.brandName}>Psyche</span>
        </div>

        <nav className={styles.navList}>
          {primaryNavItems.map((item) => (
            <Link activeProps={{ "aria-current": "page" }} className={styles.navLink} key={item.to} to={item.to}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <ThemeToggle />
        </div>
      </aside>

      <main className={styles.content}>{children}</main>
    </div>
  );
}
