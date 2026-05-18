import { ApiStatusPanel } from "@/features/home/components/ApiStatusPanel";
import styles from "@/features/home/HomePage.module.css";

export function HomePage() {
  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Self-hosted workspace</p>
        <h1>Home</h1>
      </header>

      <ApiStatusPanel />
    </section>
  );
}
