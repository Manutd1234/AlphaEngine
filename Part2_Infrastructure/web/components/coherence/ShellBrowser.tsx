"use client";

import { ArrowUp, Database, FileText, Folder, FolderOpen, Home, RefreshCw } from "lucide-react";

import type { CoherenceShell, CoherenceShellEntry } from "@/lib/coherence/types-lab";
import type { LivePoint } from "@/lib/coherence/use-live-series";

import FileReading from "./ShellFileReading";
import ShellListing, { READ_OK } from "./ShellListing";
import { Breadcrumb, pathOf, segmentsOf } from "./ShellPath";
import LiveTape from "./LiveTape";
import styles from "./ShellBrowser.module.css";

function PathBranch({
  segments,
  index,
  command,
  children,
  onNavigate,
}: {
  segments: readonly string[];
  index: number;
  command: string;
  children: readonly CoherenceShellEntry[];
  onNavigate: (path: string) => void;
}) {
  const segment = segments[index];
  if (segment == null) return null;
  const current = index === segments.length - 1;
  const currentFile = current && command === "cat";
  const Icon = currentFile ? FileText : FolderOpen;
  return (
    <ul>
      <li>
        <button
          type="button"
          aria-current={current ? "location" : undefined}
          aria-disabled={currentFile || undefined}
          className={styles.treeRow}
          data-current={current || undefined}
          data-file={currentFile || undefined}
          onClick={() => { if (!currentFile) onNavigate(pathOf(segments.slice(0, index + 1))); }}
        >
          <Icon aria-hidden="true" />
          <span title={segment}>{segment}</span>
        </button>
        {current ? (
          command === "ls" && children.length ? (
            <ul>
              {children.map((entry) => (
                <li key={`child:${entry.name}`}>
                  <button type="button" className={styles.treeRow} onClick={() => onNavigate(pathOf([...segments, entry.name]))}>
                    <Folder aria-hidden="true" />
                    <span title={entry.name}>{entry.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null
        ) : (
          <PathBranch
            segments={segments}
            index={index + 1}
            command={command}
            children={children}
            onNavigate={onNavigate}
          />
        )}
      </li>
    </ul>
  );
}

/** A conventional tree/list explorer over the Shell endpoint's one-level reads. */
export default function ShellBrowser({
  data,
  requestedPath,
  mode,
  loading,
  error,
  points,
  onNavigate,
  onOpen,
  onRetry,
}: {
  data?: CoherenceShell | null;
  requestedPath: string;
  mode: "ls" | "cat";
  loading: boolean;
  error: string | null;
  points: readonly LivePoint[];
  onNavigate: (path: string) => void;
  onOpen: (entry: CoherenceShellEntry) => void;
  onRetry: () => void;
}) {
  const shownPath = data?.path ?? requestedPath;
  const shownCommand = data?.command ?? mode;
  const segments = segmentsOf(shownPath);
  const parentPath = pathOf(segments.slice(0, -1));
  const expectedPath = requestedPath === "/" ? "/shards" : requestedPath;
  const atRoot = shownPath === "/" || shownPath === "/shards";
  const stale = data != null && loading
    && (data.path !== expectedPath || data.command !== mode);
  const repeatsScope = data?.command === "ls" && data.path === "/shards" && READ_OK.has(data.state);
  const liveDirectories = data?.command === "ls"
    ? data.entries.filter((entry) => entry.kind === "dir")
    : [];
  // `unavailable` is also a valid, file-specific `cat` result: a derived file
  // can exist even when this read could not produce its body. Keep those in
  // `FileReading`, which explains the individual file. The recovery card is
  // only for a directory listing that could not be completed.
  const directoryUnavailable = data?.state === "unavailable"
    && data.exists
    && data.command === "ls"
    && mode === "ls";
  const budgetLimited = directoryUnavailable && /read budget exhausted/i.test(data.detail);
  const measuredPolls = points.filter((point) => point.value != null).length;
  const stateLabel = !data
    ? error ? "read failed" : "opening"
    : error ? "stale" : loading ? "refreshing" : data.state;

  return (
    <section className={styles.browser} aria-label="Filesystem browser">
      <header className={styles.toolbar}>
        <div className={styles.navButtons}>
          <button type="button" onClick={() => onNavigate("/")} aria-label="Go to filesystem root" title="Root">
            <Home aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate(parentPath)}
            disabled={atRoot}
            aria-label="Go up one directory"
            title="Up one level"
          >
            <ArrowUp aria-hidden="true" />
          </button>
        </div>
        <div className={styles.pathBar}>
          <span aria-hidden="true">$</span>
          <code>{shownCommand}</code>
          <Breadcrumb path={shownPath} command={shownCommand} onNavigate={onNavigate} />
        </div>
        <span className={styles.readState} data-state={stateLabel}>{stateLabel}</span>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.tree} aria-label="Folder tree">
          <header><span>Explorer</span><small>read only</small></header>
          <nav aria-label="Path hierarchy">
            <ul>
              <li>
                <button
                  type="button"
                  aria-current={segments.length === 0 ? "location" : undefined}
                  className={styles.treeRow}
                  data-current={segments.length === 0 || undefined}
                  onClick={() => onNavigate("/")}
                >
                  <Database aria-hidden="true" />
                  <span>watched universe</span>
                </button>
                <PathBranch
                  segments={segments}
                  index={0}
                  command={shownCommand}
                  children={liveDirectories}
                  onNavigate={onNavigate}
                />
              </li>
            </ul>
          </nav>
          <footer>
            <span>{data?.command === "ls" ? `${data.entries.length} items` : "file preview"}</span>
            <span>{stateLabel}</span>
          </footer>
        </aside>

        <section className={styles.content} aria-labelledby="shell-browser-current">
          <header className={styles.contentHead}>
            <span>
              <small>{shownCommand === "cat" ? "File preview" : "Current directory"}</small>
              <strong id="shell-browser-current">{segments.at(-1) ?? "/"}</strong>
            </span>
            <code>{shownPath}</code>
          </header>

          {stale && data ? (
            <p className={styles.notice}>
              <span aria-hidden="true">◌</span> Still showing <code>{data.command}</code> {data.path} while <code>{mode}</code> {requestedPath} is read.
            </p>
          ) : null}

          {data?.detail && !repeatsScope && !directoryUnavailable ? <p className={styles.detail}>{data.detail}.</p> : null}

          {!data ? (
            <p className={styles.empty}>
              <span aria-hidden="true">{error ? "✕" : "◌"}</span>{" "}
              {error ? `The tree could not be read: ${error}.` : "Listing the watched universe…"}
            </p>
          ) : directoryUnavailable ? (
            <section className={styles.recovery} aria-labelledby="shell-browser-recovery">
              <span className={styles.recoveryIcon} aria-hidden="true"><RefreshCw /></span>
              <div className={styles.recoveryCopy}>
                <div className={styles.recoveryStatus} role="status">
                  <strong id="shell-browser-recovery">
                    {budgetLimited ? "Read capacity is replenishing" : "Live directory temporarily unavailable"}
                  </strong>
                  <p>
                    {budgetLimited
                      ? "The shared venue-read budget was just below the order-book step’s cost. This path has not been reported empty; retry the directory once capacity refills."
                      : "The venue read stopped before this directory could be listed. Nothing here is being reported as missing or empty."}
                  </p>
                </div>
                {data.detail ? (
                  <details className={styles.recoveryDetail}>
                    <summary>Gateway detail</summary>
                    <p>{data.detail}</p>
                  </details>
                ) : null}
              </div>
              <button type="button" className={styles.retryButton} onClick={onRetry}>
                <RefreshCw aria-hidden="true" /> Retry directory
              </button>
            </section>
          ) : mode === "cat" ? (
            <div className={styles.preview}><FileReading data={data} requested={requestedPath} loading={loading} /></div>
          ) : data.command !== "ls" ? (
            <p className={styles.empty}>Listing {requestedPath}…</p>
          ) : !data.exists ? (
            <p className={styles.empty}><span aria-hidden="true">○</span> No such path: {requestedPath}.</p>
          ) : (
            <ShellListing data={data} atShards={segmentsOf(data.path).length === 1} onOpen={onOpen} />
          )}

          {directoryUnavailable ? null : (
            <details className={`disclosure ${styles.scope}`}>
              <summary>What this explorer covers</summary>
              <p>
                This is the watchlist, not the whole exchange. It reads only the series named in <code>COHERENCE_SERIES</code>.
              </p>
            </details>
          )}

          {error && data ? (
            <p className={styles.notice}><span aria-hidden="true">✕</span> The last refresh failed: {error}. The explorer retains the previous answer.</p>
          ) : null}

          {mode === "ls" && data?.command === "ls" && READ_OK.has(data.state) && measuredPolls >= 2 ? (
            <LiveTape
              points={points}
              caption={`What has been under ${data.path}, poll by poll`}
              ariaLabel="The number of entries listed under this path over the polls seen since this tab opened"
              format={(value) => `${Math.round(value)}`}
              reading="A step is a series the recorder started or stopped watching, not a price."
            />
          ) : null}
        </section>
      </div>
    </section>
  );
}
