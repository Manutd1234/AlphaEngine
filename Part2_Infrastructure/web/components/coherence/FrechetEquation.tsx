import styles from "./CombosTables.module.css";

/**
 * The Fréchet–Hoeffding joint-probability bound, exposed with ARIA's math role.
 *
 * The old pane rendered this as one code string. Three rows expose the two
 * definitions and the inequality they support. The native math role and full
 * spoken label preserve the expression for assistive technology without a
 * typesetting dependency.
 */
export default function FrechetEquation() {
  return (
    <figure className={`coh-combo__formula ${styles.equation}`}>
      <figcaption className={styles.equationCaption}>Fréchet–Hoeffding joint bound</figcaption>
      <div
        className={styles.math}
        role="math"
        aria-label="L equals the maximum of zero and the sum of the leg probabilities minus n plus one; L is less than or equal to the probability of all legs, which is less than or equal to U; U equals the minimum leg probability"
      >
        <div className={styles.equationTier}>
          <var>L</var><span>=</span><span>max(0, ∑<sub>i</sub> p<sub>i</sub> − n + 1)</span>
        </div>
        <div className={styles.equationTier}>
          <var>L</var><span>≤</span><span>P(∩<sub>i</sub> A<sub>i</sub>) ≤ <var>U</var></span>
        </div>
        <div className={styles.equationTier}>
          <var>U</var><span>=</span><span>min<sub>i</sub> p<sub>i</sub></span>
        </div>
      </div>
    </figure>
  );
}
