import manifest from "@/lib/repository-manifest.generated.json";

export const GITHUB_SOURCE_ROOT =
  "https://github.com/Manutd1234/Developer_Analyst_Infra/blob/main";

export const REPOSITORY_AREAS = [
  {
    id: "web-experience",
    label: "Web experience",
    shortLabel: "Web UI",
    owner: "Product engineering",
    lifecycle: "Deployed",
    description: "The App Router shell, role workspaces, shared components, and public assets.",
  },
  {
    id: "web-runtime",
    label: "Web runtime",
    shortLabel: "Web runtime",
    owner: "Platform engineering",
    lifecycle: "Deployed",
    description: "Next.js route handlers and typed domain logic used by the desk workspace.",
  },
  {
    id: "providers",
    label: "Provider layer",
    shortLabel: "Providers",
    owner: "Data engineering",
    lifecycle: "Deployed",
    description: "Market-data adapters, routing, contracts, quarantine, and provider telemetry.",
  },
  {
    id: "web-verification",
    label: "Web verification",
    shortLabel: "Web tests",
    owner: "Product engineering",
    lifecycle: "CI enforced",
    description: "Offline TypeScript suites, parity fixtures, and structural workspace checks.",
  },
  {
    id: "gateway",
    label: "Gateway runtime",
    shortLabel: "Gateway",
    owner: "Quant platform",
    lifecycle: "Deployed",
    description: "FastAPI execution, risk, research, audit, jobs, metrics, and Telegram modules.",
  },
  {
    id: "gateway-quality",
    label: "Gateway quality",
    shortLabel: "Gateway quality",
    owner: "Quant platform",
    lifecycle: "CI enforced",
    description: "Python tests, committed contracts, probes, runbooks, and repository guards.",
  },
  {
    id: "openbb",
    label: "OpenBB service",
    shortLabel: "OpenBB",
    owner: "Research platform",
    lifecycle: "Deployed",
    description: "The stateless research-data service, provider facade, and its contract tests.",
  },
  {
    id: "research-assets",
    label: "Research assets",
    shortLabel: "Research",
    owner: "Quant research",
    lifecycle: "Reference",
    description: "Notebooks, templates, and repository-owned research data placeholders.",
  },
  {
    id: "data-assessment",
    label: "Data assessment",
    shortLabel: "Part 1",
    owner: "Data analysis",
    lifecycle: "Assessment",
    description: "The separate Part 1 source data, notebook, workbook, and written deliverable.",
  },
  {
    id: "platform-data",
    label: "Platform data",
    shortLabel: "Platform data",
    owner: "Quant platform",
    lifecycle: "Deployed",
    description: "Supabase Postgres mirror: migrations, RLS policies, seed data, and edge functions.",
  },
  {
    id: "delivery",
    label: "Delivery & configuration",
    shortLabel: "Delivery",
    owner: "Platform engineering",
    lifecycle: "Repository",
    description: "CI workflows, dependency manifests, deployment configuration, and root documentation.",
  },
] as const;

export type RepositoryAreaId = (typeof REPOSITORY_AREAS)[number]["id"];
export type RepositoryFileKind =
  | "API route"
  | "Application shell"
  | "Component"
  | "Contract"
  | "Data asset"
  | "Documentation"
  | "Fixture"
  | "Module"
  | "Notebook"
  | "Public asset"
  | "Test"
  | "Tooling"
  | "Workflow"
  | "Configuration";

export interface RepositoryFile {
  path: string;
  name: string;
  directory: string;
  extension: string;
  language: string;
  kind: RepositoryFileKind;
  areaId: RepositoryAreaId;
  sourceUrl: string;
}

export const DEPLOYABLES = [
  {
    id: "workspace",
    name: "Next.js workspace",
    role: "Interactive desk portal",
    entry: "Part2_Infrastructure/web/app/page.tsx",
    stack: "Next.js, React, TypeScript",
    detail: "Role workflows plus twenty server-side API handlers.",
  },
  {
    id: "gateway",
    name: "FastAPI gateway",
    role: "Authoritative trading service",
    entry: "Part2_Infrastructure/main.py",
    stack: "FastAPI, Python, DuckDB",
    detail: "Execution, portfolio, risk, audit, jobs, and Telegram control.",
  },
  {
    id: "openbb",
    name: "OpenBB service",
    role: "Stateless research data",
    entry: "Part2_Infrastructure/OpenBB_Service/app.py",
    stack: "FastAPI, OpenBB, Python",
    detail: "Quote, bars, news, and fundamentals behind one provider facade.",
  },
] as const;

function areaForPath(path: string): RepositoryAreaId {
  if (path.startsWith("Part1_Data_Handling/")) return "data-assessment";
  if (path.startsWith("Part2_Infrastructure/OpenBB_Service/")) return "openbb";
  if (path.startsWith("Part2_Infrastructure/web/tests/")) return "web-verification";
  if (path.startsWith("Part2_Infrastructure/web/lib/providers/")) return "providers";
  if (
    path.startsWith("Part2_Infrastructure/web/components/")
    || path.startsWith("Part2_Infrastructure/web/public/")
    || (/^Part2_Infrastructure\/web\/app\/(?!api\/)/).test(path)
  ) return "web-experience";
  if (
    path.startsWith("Part2_Infrastructure/web/app/api/")
    || path.startsWith("Part2_Infrastructure/web/lib/")
  ) return "web-runtime";
  if (
    path.startsWith("Part2_Infrastructure/tests/")
    || path.startsWith("Part2_Infrastructure/tools/")
    || path.startsWith("Part2_Infrastructure/docs/")
  ) return "gateway-quality";
  if (
    path.startsWith("Part2_Infrastructure/notebooks/")
    || path.startsWith("Part2_Infrastructure/data/")
    || path.startsWith("Part2_Infrastructure/templates/")
  ) return "research-assets";
  if (path.startsWith("supabase/")) return "platform-data";
  if (
    path.startsWith("Part2_Infrastructure/modules/")
    || [
      "Part2_Infrastructure/main.py",
      "Part2_Infrastructure/config.py",
      "Part2_Infrastructure/celery_tasks.py",
      "Part2_Infrastructure/worker.py",
    ].includes(path)
  ) return "gateway";
  return "delivery";
}

function extensionForPath(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLocaleLowerCase();
}

function languageForPath(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  if (name === "Dockerfile" || name.endsWith(".Dockerfile") || name === ".dockerignore") return "Dockerfile";
  const extension = extensionForPath(path);
  const languages: Record<string, string> = {
    ".css": "CSS",
    ".html": "HTML",
    ".ini": "INI",
    ".ipynb": "Notebook",
    ".js": "JavaScript",
    ".json": "JSON",
    ".md": "Markdown",
    ".mjs": "JavaScript",
    ".png": "Image",
    ".py": "Python",
    ".sh": "Shell",
    ".sql": "SQL",
    ".svg": "SVG",
    ".toml": "TOML",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".txt": "Text",
    ".xlsx": "Spreadsheet",
    ".yml": "YAML",
    ".yaml": "YAML",
  };
  return languages[extension] ?? "Other";
}

function kindForPath(path: string): RepositoryFileKind {
  const name = path.split("/").at(-1) ?? path;
  if (path.includes("/.github/workflows/") || path.startsWith(".github/workflows/")) return "Workflow";
  if (path.includes("/tests/") || /(^|\/)(test_[^/]+\.py|[^/]+\.test\.ts)$/.test(path)) return "Test";
  if (path.includes("/fixtures/")) return "Fixture";
  if (path.includes("/app/api/") && name === "route.ts") return "API route";
  if (path.includes("/components/") && name.endsWith(".tsx")) return "Component";
  if (/\/(page|layout)\.tsx$/.test(path)) return "Application shell";
  if (name === "openapi.json" || name.includes("parity") || name === "schemas.py") return "Contract";
  // A migration is a contract with the database: applied once, never edited.
  if (path.includes("supabase/migrations/")) return "Contract";
  if (name === "Dockerfile" || name.endsWith(".Dockerfile") || name === ".dockerignore" || name.endsWith("compose.yml")) {
    return "Configuration";
  }
  if (name.endsWith(".ipynb")) return "Notebook";
  if (path.includes("/public/")) return "Public asset";
  if (name.endsWith(".md")) return "Documentation";
  if (path.includes("/tools/") || path.includes("/scripts/")) return "Tooling";
  if ([".json", ".toml", ".ini", ".yml", ".yaml", ".example", ".gitignore", ".vercelignore", ".txt"].some((suffix) => name.endsWith(suffix))) {
    return "Configuration";
  }
  if ([".png", ".svg", ".xlsx", ".html"].some((suffix) => name.endsWith(suffix))) return "Data asset";
  return "Module";
}

function sourceUrl(path: string): string {
  const encodedPath = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `${GITHUB_SOURCE_ROOT}/${encodedPath}`;
}

export const REPOSITORY_FILES: RepositoryFile[] = manifest.files.map((path) => {
  const segments = path.split("/");
  return {
    path,
    name: segments.at(-1) ?? path,
    directory: segments.slice(0, -1).join("/") || ".",
    extension: extensionForPath(path),
    language: languageForPath(path),
    kind: kindForPath(path),
    areaId: areaForPath(path),
    sourceUrl: sourceUrl(path),
  };
});

export const REPOSITORY_STATS = {
  files: REPOSITORY_FILES.length,
  areas: REPOSITORY_AREAS.length,
  languages: new Set(REPOSITORY_FILES.map((file) => file.language).filter((language) => language !== "Other")).size,
  tests: REPOSITORY_FILES.filter((file) => file.kind === "Test").length,
  webRoutes: REPOSITORY_FILES.filter((file) => file.kind === "API route").length,
} as const;

/**
 * When and at which commit the manifest was generated. Rendered beside every
 * figure derived from it — a count with no date is the drift this repo keeps
 * re-catching (see the CI_JOBS comment in DeveloperConsole).
 */
export const REPOSITORY_MANIFEST_PROVENANCE = {
  generatedAt: manifest.generatedAt,
  commit: manifest.commit,
} as const;

export function repositoryArea(areaId: RepositoryAreaId) {
  return REPOSITORY_AREAS.find((area) => area.id === areaId) ?? REPOSITORY_AREAS.at(-1)!;
}

export function repositoryFilePurpose(file: RepositoryFile): string {
  const area = repositoryArea(file.areaId);
  const purposeByKind: Partial<Record<RepositoryFileKind, string>> = {
    "API route": "A server-side HTTP boundary for the workspace.",
    "Application shell": "Part of the rendered application shell and workspace routing.",
    Component: "A React interface component used by one or more desk workflows.",
    Contract: "A checked contract or parity artifact shared across runtimes.",
    Documentation: "Repository guidance, operating context, or a runbook.",
    Fixture: "Deterministic input used to keep implementations in agreement.",
    Notebook: "A reproducible research entry point kept beside the production engine.",
    Test: "Offline verification executed by a repository test suite.",
    Tooling: "A developer or CI utility used to inspect, verify, or generate an artifact.",
    Workflow: "A delivery workflow that defines automated repository gates.",
  };
  return `${purposeByKind[file.kind] ?? `A ${file.kind.toLocaleLowerCase()} in this repository.`} ${area.description}`;
}
