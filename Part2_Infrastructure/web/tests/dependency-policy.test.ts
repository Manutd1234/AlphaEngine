import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("..", import.meta.url));

interface PackageManifest {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  overrides?: Record<string, string>;
}

const manifest = JSON.parse(readFileSync(join(WEB, "package.json"), "utf8")) as PackageManifest;

const RUNTIME_ALLOWLIST: Record<string, string> = {
  "@supabase/supabase-js": "^2.112.2",
  "class-variance-authority": "0.7.1",
  "clsx": "2.1.1",
  "lucide-react": "^1.28.0",
  "next": "16.3.0",
  "oracledb": "^6.9.0",
  "radix-ui": "1.6.7",
  "react": "19.2.8",
  "react-dom": "19.2.8",
  "tailwind-merge": "3.6.0",
};

const DEVELOPMENT_ALLOWLIST: Record<string, string> = {
  "@axe-core/playwright": "4.13.0",
  "@playwright/test": "1.62.1",
  "@tailwindcss/postcss": "^4.3.3",
  "@types/node": "^22",
  "@types/oracledb": "^7.0.2",
  "@types/react": "^19",
  "@types/react-dom": "^19",
  "autoprefixer": "^10.5.4",
  "tailwindcss": "^4.3.3",
  "tsx": "^4.23.5",
  "typescript": "^5.6",
};

describe("the reviewed web dependency boundary", () => {
  it("allows exactly the reviewed runtime packages and versions", () => {
    assert.deepEqual(
      manifest.dependencies,
      RUNTIME_ALLOWLIST,
      "runtime dependency drift requires a new ADR and an explicit allowlist change",
    );
  });

  it("keeps browser qualification tooling development-only and exact", () => {
    assert.deepEqual(
      manifest.devDependencies,
      DEVELOPMENT_ALLOWLIST,
      "development dependency drift requires a reviewed release-tooling change",
    );
  });

  it("does not ship initializer or animation packages", () => {
    const all = { ...manifest.dependencies, ...manifest.devDependencies };
    assert.equal(all.shadcn, undefined);
    assert.equal(all["tw-animate-css"], undefined);
    assert.equal(all.recharts, undefined);
  });

  it("pins the audited transitive nanoid floor", () => {
    assert.deepEqual(manifest.overrides, { nanoid: "3.3.18" });
  });
});

describe("the controlled shadcn project contract", () => {
  it("uses the reviewed Radix, Tailwind, alias, and source paths", () => {
    const config = JSON.parse(readFileSync(join(WEB, "components.json"), "utf8")) as {
      style: string;
      rsc: boolean;
      tsx: boolean;
      tailwind: { config: string; css: string; baseColor: string; cssVariables: boolean; prefix: string };
      iconLibrary: string;
      aliases: Record<string, string>;
    };

    assert.equal(config.style, "new-york");
    assert.equal(config.rsc, true);
    assert.equal(config.tsx, true);
    assert.deepEqual(config.tailwind, {
      config: "",
      css: "app/tailwind.css",
      baseColor: "neutral",
      cssVariables: true,
      prefix: "",
    });
    assert.equal(config.iconLibrary, "lucide");
    assert.deepEqual(config.aliases, {
      components: "@/components",
      utils: "@/lib/utils",
      ui: "@/components/ui",
      lib: "@/lib",
      hooks: "@/hooks",
    });
  });
});
