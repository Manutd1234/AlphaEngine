"use client";

/** The derived files grouped by the operational meaning of an empty read. */

import { DERIVED_FILES } from "./ShellTree";
import Figure from "./Figure";
import styles from "./ShellReadings.module.css";

type Kind = "always" | "family" | "read";

const GROUPS: ReadonlyArray<{
  kind: Kind;
  step: string;
  title: string;
  mark: string;
  meaning: string;
  retry: string;
}> = [
  {
    kind: "always",
    step: "Gateway contract",
    title: "Always answers",
    mark: "●",
    meaning: "These files are addressable for every listed event. A blank result is a defect, not a market reading.",
    retry: "Investigate",
  },
  {
    kind: "family",
    step: "Event shape",
    title: "Depends on family",
    mark: "○",
    meaning: "The contract family decides whether this derived quantity exists. Repeating the same read changes nothing.",
    retry: "Do not retry",
  },
  {
    kind: "read",
    step: "On-demand solve",
    title: "Not in this listing",
    mark: "◌",
    meaning: "The file is solved when requested rather than included in every namespace listing.",
    retry: "Read on demand",
  },
];

/** Exported for the source-level contract tests and other namespace summaries. */
export function kindOf(file: { emptyKind: Kind }): Kind {
  return file.emptyKind;
}

export default function ShellReadings() {
  const grouped = GROUPS.map((group) => ({
    ...group,
    files: DERIVED_FILES.filter((file) => kindOf(file) === group.kind),
  }));

  return (
    <Figure
      caption="The five derived readings, by what an empty one means"
      ariaLabel={grouped.map((group) => `${group.title}: ${group.files.map((file) => file.name).join(", ")}`).join(". ")}
      reading="The gateway defines which files can be addressed, the event family defines which quantities make sense, and only the on-demand certificate is worth asking for again."
      missing="A namespace listing reports absence explicitly; the desk never converts a missing derived value into zero."
    >
      <div className={styles.flow} aria-label="How a derived file reaches a reading">
        <span>Gateway lists the file</span>
        <i aria-hidden="true">→</i>
        <span>Event shape is evaluated</span>
        <i aria-hidden="true">→</i>
        <span>Read returns a value or a named absence</span>
      </div>

      <div className={styles.groups}>
        {grouped.map((group, index) => (
          <section className={styles.group} key={group.kind} data-kind={group.kind}>
            <header>
              <span className={styles.index}>{index + 1}</span>
              <div>
                <small>{group.step}</small>
                <h4><span aria-hidden="true">{group.mark}</span> {group.title}</h4>
              </div>
            </header>
            <p>{group.meaning}</p>
            <div className={`table-wrap ${styles.tableWrap}`}>
              <table className="coh-table">
                <caption className="coh-table__caption">
                  Derived files in the {group.title.toLowerCase()} group.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Reading</th>
                    <th scope="col">What it reads</th>
                  </tr>
                </thead>
                <tbody>
                  {group.files.map((file) => (
                    <tr key={file.name}>
                      <th scope="row"><code>{file.name}</code></th>
                      <td>{file.reads}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer>
              <span>When empty</span>
              <strong>{group.retry}</strong>
            </footer>
          </section>
        ))}
      </div>
    </Figure>
  );
}
