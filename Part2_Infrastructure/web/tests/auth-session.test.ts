/**
 * The session probe: bounded, resolved once, and honest about what it does not
 * know.
 *
 * `getSession()` carries no timeout of its own, so blocked storage or a hung
 * network leaves the promise pending forever. The page still renders and still
 * returns 200 — every automated check stays green while the header shimmers for
 * the life of the tab. That is the failure this suite exists for, and the
 * fallback it pins is deliberately signed-out: signed-out grants nothing and
 * offers an action, which is the safe reading of "we could not determine the
 * session". There is no fifth state for "we do not know".
 *
 * `useAuth` is the same discipline at the call site — the shape callers want,
 * derived from the shared store rather than a React context that would
 * re-render every consumer on every change.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { code, session } from "./helpers/auth-sources";

describe("the session probe cannot hang the header", () => {
  it("bounds the first read with a timeout", () => {
    // getSession() carries no timeout of its own. Blocked storage or a hung
    // network leaves the promise pending forever — and because the page still
    // renders and returns 200, every automated check stays green while the
    // header shimmers for the life of the tab.
    assert.match(code(session), /SESSION_PROBE_TIMEOUT_MS/);
    assert.match(code(session), /setTimeout\(\(\) => settle\(SIGNED_OUT\)/);
  });

  it("resolves the probe exactly once", () => {
    assert.match(code(session), /if \(settled\) return;/);
    assert.match(code(session), /clearTimeout\(timer\)/);
  });

  it("lets a real auth event override a timed-out probe", () => {
    // A slow answer that eventually arrives should still be believed, rather
    // than being locked out by the fallback.
    const onChange = code(session).slice(code(session).indexOf("onAuthStateChange"));
    assert.match(onChange.slice(0, 320), /settled = true;/);
    assert.match(onChange.slice(0, 320), /publish\(fromSession\(session\)\)/);
  });

  it("falls back to signed-out, not to a fifth state", () => {
    // Signed-out grants nothing and offers an action, which is the safe
    // reading of "we could not determine the session".
    assert.match(code(session), /settle\(SIGNED_OUT\)/);
    assert.doesNotMatch(code(session), /"unavailable"|"error"|"timeout"/);
  });
});

describe("useAuth is the shape callers want, without context", () => {
  it("exposes user, isAuthenticated and sessionStatus", () => {
    assert.match(code(session), /export function useAuth\(\): AuthState/);
    assert.match(code(session), /isAuthenticated: info\.status === "signed-in"/);
    assert.match(code(session), /sessionStatus: info\.status/);
  });

  it("derives from the shared store rather than a provider", () => {
    // React context re-renders every consumer on every change, which is the
    // opposite of what reading a session should cost.
    assert.match(code(session), /const info = useSession\(\);/);
    assert.doesNotMatch(code(session), /createContext|useContext|Provider/);
  });

  it("memoises so a re-render does not churn the object identity", () => {
    assert.match(code(session), /useMemo\(/);
  });
});
