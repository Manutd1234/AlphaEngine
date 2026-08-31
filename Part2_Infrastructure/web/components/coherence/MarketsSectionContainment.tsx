import type { ReactNode } from "react";

import styles from "./MarketsSectionContainment.module.css";

export default function MarketsSectionContainment({
  variant,
  children,
}: {
  variant: "stake" | "fees";
  children: ReactNode;
}) {
  return (
    <div className={styles.root} data-markets-containment={variant}>
      {children}
    </div>
  );
}
