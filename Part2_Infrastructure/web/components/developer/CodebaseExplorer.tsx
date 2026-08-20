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

export default function CodebaseExplorer() {
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [area, setArea] = useState<RepositoryAreaId | "all">("all");
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

  const activeFile = visibleFiles.find((file) => file.path === selectedPath) ?? visibleFiles[0] ?? null;
  const activeArea = activeFile ? repositoryArea(activeFile.areaId) : null;

  return (
    <div className="card codebase-explorer">
      <div className="codebase-explorer__heading">
        <div>
          <span className="page-kicker">Repository map</span>
          <h2>Browse the complete codebase snapshot</h2>
          {/* Read-only-ness is stated once, by the notice block below — it
              carries the actionable refresh command, so it is the copy that
              earns the words. */}
          <p className="sub">
            Covers every checked-in and newly authored path in this workspace.
          </p>
        </div>
        <div className="codebase-explorer__stats" aria-label="Repository snapshot summary">
          {/* As of comes first: it qualifies the four counts beside it, and a
              count whose date is read afterwards has already been believed. */}
          <div className="codebase-explorer__asof"><span>As of</span><strong className="num">{REPOSITORY_MANIFEST_PROVENANCE.generatedAt}</strong></div>
          <div><span>Files</span><strong className="num">{REPOSITORY_STATS.files}</strong></div>
          <div><span>Areas</span><strong className="num">{REPOSITORY_STATS.areas}</strong></div>
          <div><span>Tests</span><strong className="num">{REPOSITORY_STATS.tests}</strong></div>
          <div><span>API routes</span><strong className="num">{REPOSITORY_STATS.webRoutes}</strong></div>
        </div>
      </div>

      <div className="codebase-explorer__notice">
        <strong>Read-only repository snapshot.</strong>
        <span>
          Refresh with <code>npm run catalog:refresh</code> when files are added or removed; manifest{" "}
          <code>{REPOSITORY_MANIFEST_PROVENANCE.commit}</code>.
        </span>
      </div>

      <div className="codebase-explorer__toolbar">
        <label className="codebase-explorer__search">
          <span>Search files</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Path, type, language or area…"
          />
        </label>
        <label>
          <span>Code area</span>
          <select value={area} onChange={(event) => setArea(event.target.value as RepositoryAreaId | "all")}>
            <option value="all">All code areas</option>
            {REPOSITORY_AREAS.map((areaMeta) => (
              <option key={areaMeta.id} value={areaMeta.id}>{areaMeta.label}</option>
            ))}
          </select>
        </label>
        {(query || area !== "all") && (
          <button type="button" onClick={() => { setQuery(""); setArea("all"); }}>
            Clear filters
          </button>
        )}
      </div>

      <div className="codebase-explorer__layout">
        <aside className="codebase-filelist" aria-label="Repository files">
          <div className="codebase-filelist__summary" aria-live="polite" ref={summaryRef}>
            <span>{visibleFiles.length} of {REPOSITORY_FILES.length} paths</span>
            <small>{groupedFiles.length} code areas</small>
          </div>
          {groupedFiles.length ? (
            groupedFiles.map((group) => (
              <section className="codebase-filegroup" key={group.area.id}>
                <h3>
                  <span>{group.area.shortLabel}</span>
                  <small className="num">{group.files.length}</small>
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
                          <span className={`codebase-file-icon is-${file.kind.toLocaleLowerCase().replaceAll(" ", "-")}`} aria-hidden="true">
                            {file.extension ? file.extension.slice(1, 4).toLocaleUpperCase() : "FILE"}
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
              <span>Try a shorter search or clear the code-area filter.</span>
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
                <div><dt>Artifact</dt><dd>{activeFile.kind}</dd></div>
                <div><dt>Language</dt><dd>{activeFile.language}</dd></div>
                <div><dt>Directory</dt><dd><code>{activeFile.directory}</code></dd></div>
              </dl>

              <div className="codebase-detail__context">
                <span className="page-kicker">Area responsibility</span>
                <h4>{activeArea.shortLabel}</h4>
                <p>{activeArea.description}</p>
              </div>

              <div className="codebase-detail__safe-edit">
                <strong>Ready to change it?</strong>
                <p>
                  File or link a work item; the contract, parity, type and build gates verify it.
                </p>
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
