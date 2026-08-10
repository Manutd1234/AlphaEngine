import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  PAPER_ORDER_DEFAULT_ENV,
  authorisePaperOrder,
  paperOrderDefaultAvailable,
} from "@/lib/operator";

const production = {
  NODE_ENV: "production",
  ALPHAENGINE_OPERATOR_TOKEN: "deployment-secret",
  [PAPER_ORDER_DEFAULT_ENV]: "1",
} as NodeJS.ProcessEnv;

const ordersRoute = readFileSync(
  fileURLToPath(new URL("../app/api/gateway/orders/route.ts", import.meta.url)),
  "utf8",
);
const riskRoute = readFileSync(
  fileURLToPath(new URL("../app/api/gateway/risk/route.ts", import.meta.url)),
  "utf8",
);
const actionsRoute = readFileSync(
  fileURLToPath(new URL("../app/api/system/actions/route.ts", import.meta.url)),
  "utf8",
);

describe("the deployment credential is a paper-order-only default", () => {
  it("accepts a missing header only when the exact flag and server token exist", () => {
    assert.equal(paperOrderDefaultAvailable(production), true);
    assert.equal(authorisePaperOrder(null, production), null);

    for (const value of [undefined, "", "0", "true", "yes", "2"]) {
      const env = { ...production, [PAPER_ORDER_DEFAULT_ENV]: value } as NodeJS.ProcessEnv;
      assert.equal(paperOrderDefaultAvailable(env), false);
      assert.equal(authorisePaperOrder(null, env)?.status, 401);
    }

    const withoutToken = {
      NODE_ENV: "production",
      [PAPER_ORDER_DEFAULT_ENV]: "1",
    } as NodeJS.ProcessEnv;
    assert.equal(paperOrderDefaultAvailable(withoutToken), false);
    assert.equal(authorisePaperOrder(null, withoutToken)?.status, 503);
  });

  it("treats every supplied header as an override and never falls back", () => {
    assert.equal(authorisePaperOrder("Bearer deployment-secret", production), null);
    assert.equal(authorisePaperOrder("Bearer replacement", production)?.status, 401);
    assert.equal(authorisePaperOrder("Bearer ", production)?.status, 401);
    assert.equal(authorisePaperOrder("", production)?.status, 401);
  });

  it("scopes the fallback to new paper orders", () => {
    assert.match(ordersRoute, /authorisePaperOrder\(request\.headers\.get\("authorization"\)\)/);
    assert.doesNotMatch(riskRoute, /authorisePaperOrder/);
    assert.doesNotMatch(actionsRoute, /authorisePaperOrder/);
    assert.match(riskRoute, /authorise\(request\.headers\.get\("authorization"\)\)/);
    assert.match(actionsRoute, /authorise\(request\.headers\.get\("authorization"\)\)/);
  });

  it("exposes status, never a browser credential", () => {
    assert.match(ordersRoute, /paperOrderDefaultAvailable: paperOrderDefaultAvailable\(\)/);
    assert.doesNotMatch(ordersRoute, /NEXT_PUBLIC_/);
    assert.doesNotMatch(ordersRoute, /process\.env\[?\s*OPERATOR_TOKEN_ENV/);
  });
});
