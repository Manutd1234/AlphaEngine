/**
 * The desk sweep: every tab, every section, under every backend failure.
 * =====================================================================
 *
 * The claim this pass makes is "no surface can dead-end". That claim is not
 * checkable by the unit suite, because the failures it describes are layout and
 * data-flow states that only exist in a browser talking to a backend that is
 * refusing. So this walks all 47 rail sections across all 8 tabs under six
 * fault profiles and asserts, per cell, that the panel is populated and honest.
 *
 * WHY CDP FAULT INJECTION rather than restarting the dev server with different
 * env: because one of the six profiles cannot be produced any other way. A
 * gateway that *hangs* — accepts the connection and never answers — is the state
 * a redeploying container is actually in, and it is the state that left "book
 * connecting" on screen forever when the fetch had no deadline. Interception can
 * hold a request open indefinitely; an env var cannot. The same mechanism gives
 * the other five profiles for free and keeps one dev server for the whole run.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED: that Reliability and Data show green. Those
 * two tabs exist to *report* infrastructure truth — a health matrix that invents
 * a passing probe is the one lie this codebase must not tell. On those tabs the
 * rule is inverted: they must render a complete, populated, legible report of the
 * degradation, and the degraded vocabulary is expected there rather than banned.
 * See `TRUTH_TABS` in `desk-sweep-plan.mjs`.
 *
 * Usage:
 *   PORT=3100 npm run dev                     # in one shell
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
 *     --headless=new --remote-debugging-port=9222 --disable-gpu about:blank
 *   node scripts/desk-sweep.mjs               # in another
 *   node scripts/desk-sweep.mjs --profile=gateway-hang --tab=portfolio
 *
 * Three files since 2026-08-21, split where the banners already were. WHAT is
 * swept — the rail, its section count, the fault profiles, the dead-end
 * vocabulary — is `desk-sweep-plan.mjs`. HOW a browser is driven and one panel
 * measured is `desk-sweep-cdp.mjs`. What remains here is the walk itself and
 * the verdict: the four rules that turn a measurement into a pass or a fail,
 * and the report. `EXPECTED_SECTIONS` travelled with `TABS`, because a count
 * separated from the list it counts is a guard that stops guarding.
 */

import {
  DEAD_END_PHRASES, EXPECTED_SECTIONS, MEDIA, PROFILES, TABS, TRUTH_TABS,
} from "./desk-sweep-plan.mjs";
import { connect, installProfile, HYDRATED, INSPECT } from "./desk-sweep-cdp.mjs";

const ORIGIN = process.env.SWEEP_ORIGIN ?? "http://localhost:3100";

/**
 * The desk, which is `/dashboard` since sign-in-first shipped.
 *
 * This swept `/#tab/section` and every cell reported "never hydrated" the moment
 * the root became a signpost: the sweep was landing on the login page, which has
 * no workspace shell to measure. Worth stating rather than just fixing, because a
 * harness that silently measures the wrong page is the failure mode this file's
 * own header warns about.
 *
 * On a deployment with no Supabase credentials the guard admits the sweep as a
 * guest, so no cookie setup is needed here. Against a deployment WITH auth, run
 * it with a desk cookie already in the browser profile.
 */
const DESK = `${ORIGIN}/dashboard`;

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  return {
    profile: get("profile"), tab: get("tab"),
    media: get("media"), verbose: args.includes("--verbose"),
  };
}

async function main() {
  const { profile: onlyProfile, tab: onlyTab, media: onlyMedia, verbose } = parseArgs();

  const declared = Object.values(TABS).reduce((n, list) => n + list.length, 0);
  if (declared !== EXPECTED_SECTIONS) {
    console.error(`section list drift: this file declares ${declared}, expected ${EXPECTED_SECTIONS}.`);
    console.error("If a section was added, add it here too — an unswept section is an unverified one.");
    process.exitCode = 1;
    return;
  }

  const cdp = await connect();
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  if (onlyMedia) {
    const features = MEDIA[onlyMedia];
    if (!features) {
      console.error(`unknown media "${onlyMedia}". known: ${Object.keys(MEDIA).join(", ")}`);
      process.exitCode = 1;
      return;
    }
    await cdp.send("Emulation.setEmulatedMedia", { features });
  }

  let consoleErrors = [];
  cdp.on((msg) => {
    if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push(msg.params.exceptionDetails.exception?.description
        ?? msg.params.exceptionDetails.text ?? "exception");
    }
  });

  const profiles = onlyProfile ? [onlyProfile] : Object.keys(PROFILES);
  const rows = [];

  for (const profileName of profiles) {
    if (!(profileName in PROFILES)) {
      console.error(`unknown profile "${profileName}". known: ${Object.keys(PROFILES).join(", ")}`);
      process.exitCode = 1;
      return;
    }
    const installed = await installProfile(cdp, PROFILES[profileName]);
    process.stdout.write(`\n${profileName}\n`);

    for (const [tab, sections] of Object.entries(TABS)) {
      if (onlyTab && tab !== onlyTab) continue;

      // One navigation per tab; sections switch by hash, which the workspace
      // listens for. Reloading 43 times per profile turned a 2-minute run into
      // 20 and told us nothing extra.
      consoleErrors = [];
      await cdp.send("Page.navigate", { url: `${DESK}#${tab}/${sections[0]}` });
      const ready = await cdp.evaluate(HYDRATED);
      if (!ready) {
        rows.push({ profile: profileName, tab, section: sections[0], verdict: "NOT-READY", notes: "never hydrated" });
        continue;
      }

      for (const section of sections) {
        /**
         * Wait for the panel to stop waiting, not for a fixed beat.
         *
         * A 550ms sleep reported live/trade and live/quality as permanently
         * stuck under the hang profile when they were merely inside the client's
         * 2.5s deadline — the panels populate at ~2.6s and the sweep looked at
         * 0.6s. Fixed sleeps in a harness whose whole subject is timeouts are
         * how you get confident wrong answers in both directions.
         *
         * `aria-busy="true"` is what the placeholders carry, so it is the app's
         * own statement that it is still working. The 7s cap is above every
         * client deadline in the app (2.5s) plus a retry, so hitting the cap is
         * itself a finding rather than a timing accident.
         */
        await cdp.evaluate(`(async () => {
          if (location.hash !== '#${tab}/${section}') {
            location.hash = '#${tab}/${section}';
          }
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          // Both signals: aria-busy is the app's own statement, and a bare
          // .skeleton is what a panel that forgot to say so still renders. The
          // audit trail was the second kind, and measuring it mid-probe reported
          // a 121-character dead end that resolved a second later.
          const settled = () => !document.querySelector(
            'main.workspace-shell [aria-busy="true"], main.workspace-shell .skeleton');
          const started = Date.now();
          while (!settled() && Date.now() - started < 7000) {
            await new Promise((r) => setTimeout(r, 120));
          }
          // A beat after settling, for the render that follows the state change.
          await new Promise((r) => setTimeout(r, 260));
          return settled();
        })()`);

        const seen = await cdp.evaluate(INSPECT(DEAD_END_PHRASES));
        const problems = [];

        if (seen.missing) {
          problems.push("no panel rendered");
        } else if (!seen.bodyOnly && seen.chars < 120) {
          // No rail on this tab, so the view panel IS the body.
          problems.push(`thin panel (${seen.chars} chars)`);
        } else {
          /**
           * Four rules, each derived from reading a panel this sweep got wrong.
           *
           * Not every section is a data panel, and treating them all as one
           * produced three false failures in a row: the KPI deck renders no
           * .card and no controls but six live metrics; the risk controls panel
           * is two buttons and a paragraph explaining that this workspace holds
           * no gateway credential, which is the design rather than a failure;
           * and the delivery-workflow panel mentions "unavailable" in passing
           * inside 1500 characters of real pipeline state. Meanwhile the blotter
           * had three cards and seven controls above a table with no rows, and
           * looked populated by every crude measure.
           */
          if (seen.chars < 60) problems.push(`empty section body (${seen.chars} chars)`);

          // 1 — nothing to read and nothing to do. A panel with neither data nor
          // an action is not serving any purpose, whatever it says.
          if (seen.dataPoints === 0 && seen.controls === 0) {
            problems.push(`nothing to read and nothing to do (${seen.chars} chars)`);
          }

          // 2 — a table is a promise of rows. An empty one is the blotter case:
          // filters, export menu, column headers, and nothing listed.
          if (seen.tables > 0 && seen.rows === 0) {
            problems.push(`table with no rows (${seen.tables} table(s))`);
          }

          // 3 — a dead-end phrase in a panel that is mostly that phrase. Long
          // panels carrying real data may mention a degraded feed in passing;
          // that is the honest behaviour wanted, not a failure.
          if (seen.phrases.length && seen.dataPoints < 3 && seen.chars < 600 && !TRUTH_TABS.has(tab)) {
            problems.push(`dead end: "${seen.phrases.join('", "')}"`);
          }

          // 4 — still announcing a wait. Under a hung gateway this is the one
          // that matters: a body reading "Connecting to the risk gateway…" after
          // eight seconds is not loading, it is never going to load.
          if (seen.stillWaiting) problems.push(`still waiting (${seen.head.slice(0, 40)})`);

          if (!seen.provenance) problems.push("no provenance badge in the header");
        }

        if (consoleErrors.length) {
          problems.push(`${consoleErrors.length} js error(s): ${consoleErrors[0]?.slice(0, 60)}`);
          consoleErrors = [];
        }

        rows.push({
          profile: profileName, tab, section,
          verdict: problems.length ? "FAIL" : "ok",
          chars: seen.chars ?? 0, cards: seen.cards ?? 0,
          notes: problems.join("; "),
          head: verbose ? seen.head : undefined,
        });
        process.stdout.write(problems.length ? "x" : ".");
      }
    }
    await installed.release();
  }

  // -------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------
  console.log("\n");
  const failed = rows.filter((r) => r.verdict !== "ok");
  const byProfile = new Map();
  for (const row of rows) {
    const key = row.profile;
    const entry = byProfile.get(key) ?? { total: 0, bad: 0 };
    entry.total += 1;
    if (row.verdict !== "ok") entry.bad += 1;
    byProfile.set(key, entry);
  }

  console.log("profile             cells  failing");
  console.log("-".repeat(40));
  for (const [name, { total, bad }] of byProfile) {
    console.log(`${name.padEnd(20)}${String(total).padStart(5)}${String(bad).padStart(9)}`);
  }

  if (failed.length) {
    console.log(`\n${failed.length} failing cells:`);
    for (const row of failed) {
      console.log(`  ${row.profile} · ${row.tab}/${row.section} — ${row.notes}`);
      if (row.head) console.log(`      panel: ${row.head}`);
    }
  }

  console.log(
    `\n${failed.length ? "FAIL" : "PASS"} — ${rows.length - failed.length}/${rows.length} cells`
    + ` across ${byProfile.size} profile(s)`
    + (onlyMedia ? ` under ${onlyMedia}` : "")
    + (onlyTab ? ` on ${onlyTab}` : ""),
  );
  // Never report a pass over a run that measured nothing: the panel walk in this
  // repo once reported PASS across 27 cells it had never opened.
  if (rows.length === 0) {
    console.log("INCONCLUSIVE — no cells were measured");
    process.exitCode = 1;
  } else if (failed.length) {
    process.exitCode = 1;
  }

  cdp.ws.close();
}

await main();
