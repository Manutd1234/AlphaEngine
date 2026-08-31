"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import {
  REPOSITORY_AREAS,
  REPOSITORY_FILES,
  REPOSITORY_MANIFEST_PROVENANCE,
  REPOSITORY_STATS,
  repositoryArea,
  repositoryFilePurpose,
  type RepositoryAreaId,
} from "@/lib/repository-catalog";

const CODEBASE_PAGE_SIZE = 50;
const REPOSITORY_FILES_LABEL = "Repository files";

export default function CodebaseExplorer() {
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [area, setArea] = useState<RepositoryAreaId | "all">("all");
  const [repositoryPageIndex, setRepositoryPageIndex] = useState<number | null>(null);
  const [selectedPath, setSelectedPath] = useState(
    () => REPOSITORY_FILES.find((file) => file.path.endsWith("/web/app/page.tsx"))?.path
      ?? REPOSITORY_FILES[0]?.path
      ?? "",
  );

  const visibleFiles = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase();
    return REPOSITORY_FILES.filter((file) => {
      if (area !== "all" && file.areaId !== area) return false;
      if (!needle) return true;
      const areaMeta = repositoryArea(file.areaId);
      return [file.path, file.name, file.kind, file.language, areaMeta.label]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [area, deferredQuery]);

  const groupedFiles = useMemo(() => REPOSITORY_AREAS
    .map((areaMeta) => ({
      area: areaMeta,
      files: visibleFiles.filter((file) => file.areaId === areaMeta.id),
    }))
    .filter((group) => group.files.length > 0), [visibleFiles]);

  /** Area order is the explorer's canonical scan order; paging follows it. */
  const orderedFiles = useMemo(
    () => groupedFiles.flatMap((group) => group.files),
    [groupedFiles],
  );

  const activeFile = visibleFiles.find((file) => file.path === selectedPath) ?? visibleFiles[0] ?? null;
  const activeArea = activeFile ? repositoryArea(activeFile.areaId) : null;
  const selectedIndex = activeFile
    ? orderedFiles.findIndex((file) => file.path === activeFile.path)
    : 0;
  const pageCount = Math.max(1, Math.ceil(orderedFiles.length / CODEBASE_PAGE_SIZE));
  const selectedPage = Math.max(0, Math.floor(selectedIndex / CODEBASE_PAGE_SIZE));
  const activePage = repositoryPageIndex === null
    ? selectedPage
    : Math.min(repositoryPageIndex, pageCount - 1);
  const pageStart = activePage * CODEBASE_PAGE_SIZE;
  const pagedFiles = useMemo(
    () => orderedFiles.slice(pageStart, pageStart + CODEBASE_PAGE_SIZE),
    [orderedFiles, pageStart],
  );
  const pagedGroups = useMemo(() => {
    const pagePaths = new Set(pagedFiles.map((file) => file.path));
    return groupedFiles
      .map((group) => ({
        ...group,
        total: group.files.length,
        files: group.files.filter((file) => pagePaths.has(file.path)),
      }))
      .filter((group) => group.files.length > 0);
  }, [groupedFiles, pagedFiles]);

  /**
   * Publishes the summary bar's measured height as `--codebase-summary-h`, which
   * the sticky group headings below dock against.
   *
   * The stylesheet used to hard-code `top: 39px` here. That number was measured
   * by hand against a one-line summary — the bar wraps to two lines on a narrow
   * column, and every group heading then sat behind it. Same failure, and same
   * fix, as `--header-h` in WorkspaceHeader: measure, do not count.
   */
  useEffect(() => {
    const node = summaryRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    // Written to the scroller, not to the observed node: setting a custom
    // property on the element being measured is how a ResizeObserver loop
    // starts.
    const target = node.parentElement;
    const publish = () => {
      target?.style.setProperty(
        "--codebase-summary-h",
        `${Math.round(node.getBoundingClientRect().height)}px`,
      );
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const setRepositoryPage = (nextPage: number) => {
    const bounded = Math.max(0, Math.min(nextPage, pageCount - 1));
    setRepositoryPageIndex(bounded);
    const firstFile = orderedFiles[bounded * CODEBASE_PAGE_SIZE];
    if (firstFile) setSelectedPath(firstFile.path);
    const scroller = summaryRef.current?.parentElement;
    if (scroller) scroller.scrollTop = 0;
  };

  return (
    <div className="card codebase-explorer">
      <div className="codebase-explorer__heading">
        <div>
          <span className="page-kicker">Repository map</span>
          <h2>The complete codebase snapshot</h2>
          {/* No subtitle: it restated the heading. Read-only-ness and coverage
              are stated once, by the notice block below, which also carries the
              actionable refresh command. */}
        </div>
        <div className="codebase-explorer__stats" aria-label="Repository snapshot summary">
          {/* As of comes first: it qualifies the four counts beside it, and a
              count whose date is read afterwards has already been believed. */}
          <div className="codebase-explorer__asof"><span>As of</span><strong className="num">{REPOSITORY_MANIFEST_PROVENANCE.generatedAt}</strong></div>
          <div><span>Files</span><strong className="num">{REPOSITORY_STATS.files}</strong></div>
          <div><span>Areas</span><strong className="num">{REPOSITORY_STATS.areas}</strong></div>
          {/* "Test files", not "Tests". `REPOSITORY_STATS.tests` is
              `REPOSITORY_FILES.filter(kind === "Test").length` — 447 FILES —
              and the CI / CD subtab of this same tab reports 4,008 tests,
              meaning test CASES, from `TEST_COUNTS.web.total`. Two figures an
              order of magnitude apart, both labelled "tests", two subtabs
              apart: a reader who carries one away has the wrong number and no
              way to know it. The unit is the fix, and it belongs in the label
              rather than in a note, because a note is read after the figure
              has already been believed — the same argument the "As of" stamp
              is placed first for.

              Measured before choosing the wording: this strip is
              `grid-template-columns: auto repeat(4, minmax(64px, 1fr))` inside
              `flex: 0 1 480px` (08-developer-engineering.css), so each count
              cell is ~97px wide. "TEST FILES" is exactly as many characters as
              "API ROUTES", which already sits in the sibling cell — so the
              longest label on this strip does not change and nothing rewraps.
              Rejected: "Test suites" (wrong — a file is not a suite) and
              leaving it and adding a tooltip (a hover is not available to the
              reader who is scanning four figures). */}
          <div><span>Test files</span><strong className="num">{REPOSITORY_STATS.tests}</strong></div>
          <div><span>API routes</span><strong className="num">{REPOSITORY_STATS.webRoutes}</strong></div>
        </div>
      </div>

      <p className="codebase-explorer__provenance">
        <strong>Read-only repository snapshot.</strong>{" "}
        Refresh with <code>npm run catalog:refresh</code> when files are added or removed; manifest commit{" "}
        <code>{REPOSITORY_MANIFEST_PROVENANCE.commit}</code>.
      </p>

      <div className="codebase-explorer__toolbar">
        <label className="codebase-explorer__search">
          <span>Search files</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setRepositoryPageIndex(null);
            }}
            placeholder="Path, type, language or area…"
          />
        </label>
        <label>
          <span>Code area</span>
          <select
            value={area}
            onChange={(event) => {
              setArea(event.target.value as RepositoryAreaId | "all");
              setRepositoryPageIndex(null);
            }}
          >
            <option value="all">All code areas</option>
            {REPOSITORY_AREAS.map((areaMeta) => (
              <option key={areaMeta.id} value={areaMeta.id}>{areaMeta.label}</option>
            ))}
          </select>
        </label>
        {(query || area !== "all") && (
          <button type="button" onClick={() => { setQuery(""); setArea("all"); setRepositoryPageIndex(null); }}>
            Clear filters
          </button>
        )}
      </div>

      <div className="codebase-explorer__layout">
        <aside className="codebase-filelist" aria-label={REPOSITORY_FILES_LABEL}>
          <div className="codebase-filelist__summary" aria-live="polite" ref={summaryRef}>
            <div>
              <span>{visibleFiles.length} of {REPOSITORY_FILES.length} paths</span>
              <small>{groupedFiles.length} code areas</small>
            </div>
            {orderedFiles.length ? (
              <div className="codebase-filelist__pagination" role="group" aria-label={REPOSITORY_FILES_LABEL}>
                <button
                  type="button"
                  onClick={() => setRepositoryPage(activePage - 1)}
                  disabled={activePage === 0}
                  aria-label={[REPOSITORY_FILES_LABEL, activePage].join(" ")}
                >
                  ‹
                </button>
                <select
                  value={activePage}
                  onChange={(event) => setRepositoryPage(Number(event.target.value))}
                  aria-label={REPOSITORY_FILES_LABEL}
                >
                  {Array.from({ length: pageCount }, (_, index) => (
                    <option key={index} value={index}>{index + 1}</option>
                  ))}
                </select>
                <span>/{pageCount}</span>
                <button
                  type="button"
                  onClick={() => setRepositoryPage(activePage + 1)}
                  disabled={activePage === pageCount - 1}
                  aria-label={[REPOSITORY_FILES_LABEL, activePage + 2].join(" ")}
                >
                  ›
                </button>
              </div>
            ) : null}
          </div>
          {groupedFiles.length ? (
            pagedGroups.map((group) => (
              <section className="codebase-filegroup" key={group.area.id}>
                <h3>
                  <span>{group.area.shortLabel}</span>
                  <small className="num">{group.total}</small>
                </h3>
                <ul>
                  {group.files.map((file) => {
                    const selected = activeFile?.path === file.path;
                    return (
                      <li key={file.path}>
                        <button
                          type="button"
                          className={selected ? "is-selected" : undefined}
                          aria-current={selected ? "true" : undefined}
                          onClick={() => setSelectedPath(file.path)}
                          title={file.path}
                        >
                          {/* Four characters, not three. `slice(1, 4)` printed
                              "JSO" on every `.json` path — 33 of the 1,413 in
                              the manifest, and they are `package.json`,
                              `tsconfig.json` and `tools/openapi.json`, the
                              files a reviewer opens this explorer to find. A
                              badge truncated mid-word reads as a rendering
                              bug, which is the last thing a repository map
                              wants to be doing to its most-clicked rows. It
                              also cost "HTML" and "TOML" a letter each.

                              Four fits, and this is measured rather than
                              estimated: the extension-less branch beside it
                              already renders "FILE" — four characters, in this
                              same 35px box, at every one of the three
                              `--type-step` settings — on 12 paths today. So
                              the box is known to hold four; nothing about the
                              stylesheet has to change, and 08-developer-
                              engineering.css is not this component's to edit
                              anyway. `.ipynb`, `.example` and `.dockerfile`
                              still clip, at 6 paths between them; a per-
                              extension label map would fix those and is
                              rejected as a table invented for six rows. */}
                          <span className={`codebase-file-icon is-${file.kind.toLocaleLowerCase().replaceAll(" ", "-")}`} aria-hidden="true">
                            {file.extension ? file.extension.slice(1, 5).toLocaleUpperCase() : "FILE"}
                          </span>
                          <span>
                            <strong>{file.name}</strong>
                            <small>{file.directory}</small>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          ) : (
            <div className="codebase-filelist__empty">
              <strong>No matching paths</strong>
              <span>Shorten the search, or clear the code-area filter.</span>
            </div>
          )}
        </aside>

        <section className="codebase-detail" aria-live="polite">
          {activeFile && activeArea ? (
            <>
              <div className="codebase-detail__header">
                <div>
                  <span className="page-kicker">Selected file</span>
                  <h3>{activeFile.name}</h3>
                  <code>{activeFile.path}</code>
                </div>
                {/* Leaves the application, so it reads as a link rather than
                    as the desk's loudest control. */}
                <a className="text-action" href={activeFile.sourceUrl} target="_blank" rel="noreferrer">
                  Open source ↗
                </a>
              </div>

              <p className="codebase-detail__purpose">{repositoryFilePurpose(activeFile)}</p>

              <dl className="codebase-detail__meta">
                <div><dt>Code area</dt><dd>{activeArea.label}</dd></div>
                <div><dt>Owner</dt><dd>{activeArea.owner}</dd></div>
                <div><dt>Lifecycle</dt><dd>{activeArea.lifecycle}</dd></div>
                {/* "File kind", not "Artifact". On this tab "artifact" is
                    already taken, and taken by the thing a promotion decision
                    turns on: Artifact custody is one of the five launch gates,
                    and Artifact lineage and Artifact registry are the two
                    tables that carry a signed build's provenance. This field
                    holds `file.kind` — Module, Test, Component, Configuration,
                    Tooling, API route, Contract, Documentation, Application
                    shell — which is a category of source file, not a build
                    output. Read beside "LANGUAGE: TypeScript" one cell over,
                    "ARTIFACT: Test" also invites the wrong reading: what this
                    file compiles into. Rejected: "Type", which collides with
                    the Task Queue composer's own Type select and with the
                    file-type badge in the list beside this panel. */}
                <div><dt>File kind</dt><dd>{activeFile.kind}</dd></div>
                <div><dt>Language</dt><dd>{activeFile.language}</dd></div>
                <div><dt>Directory</dt><dd><code>{activeFile.directory}</code></dd></div>
              </dl>

              <div className="codebase-detail__context">
                <span className="page-kicker">Area responsibility</span>
                <h4>{activeArea.shortLabel}</h4>
                <p>{activeArea.description}</p>
              </div>

            </>
          ) : (
            <div className="codebase-detail__empty">
              <strong>Select a repository path</strong>
              <span>Its ownership, purpose, and canonical source link will appear here.</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
