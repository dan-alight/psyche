import { useQuery } from "@tanstack/react-query";

import { Button, Panel } from "@/components/ui";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { getHealth } from "@/lib/api";
import styles from "@/components/HomePage.module.css";

export function HomePage() {
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: getHealth
  });

  const status = healthQuery.data?.ok ? "Connected" : healthQuery.isError ? "Unavailable" : "Checking";

  return (
    <main className={styles.page}>
      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Self-hosted workspace</p>
            <h1>Psyche</h1>
          </div>
          <ThemeToggle />
        </header>

        <Panel className={styles.statusPanel} aria-label="System status">
          <div>
            <p className={styles.label}>API status</p>
            <p className={styles.status}>{status}</p>
          </div>
          <div className={styles.statusActions}>
            <span aria-hidden="true" className={healthQuery.data?.ok ? styles.readyDot : styles.pendingDot} />
            <Button
              disabled={healthQuery.isFetching}
              size="sm"
              variant="secondary"
              type="button"
              onClick={() => void healthQuery.refetch()}
            >
              Refresh
            </Button>
          </div>
        </Panel>

        {healthQuery.error ? <p className={styles.error}>{healthQuery.error.message}</p> : null}
      </section>
    </main>
  );
}
