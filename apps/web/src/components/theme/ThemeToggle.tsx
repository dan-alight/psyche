import { useTheme } from "@/theme";
import type { ThemePreference } from "@/theme";
import styles from "@/components/theme/ThemeToggle.module.css";

const themeOptions: Array<{ label: string; value: ThemePreference }> = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" }
];

export function ThemeToggle() {
  const { preference, resolvedTheme, setPreference } = useTheme();

  return (
    <div className={styles.field}>
      <span className={styles.label}>Theme</span>
      <div className={styles.control} role="group" aria-label={`Theme, currently ${resolvedTheme}`}>
        {themeOptions.map((option) => (
          <button
            aria-pressed={preference === option.value}
            className={preference === option.value ? styles.activeOption : styles.option}
            key={option.value}
            type="button"
            onClick={() => setPreference(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
