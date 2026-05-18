import type { HTMLAttributes } from "react";

import styles from "@/components/ui/Panel.module.css";

export type PanelTone = "default" | "muted";

export type PanelProps = HTMLAttributes<HTMLElement> & {
  tone?: PanelTone;
};

export function Panel({ className, tone = "default", ...props }: PanelProps) {
  const classes = [styles.panel, styles[tone], className].filter(Boolean).join(" ");

  return <section className={classes} {...props} />;
}
