import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildEngineInventory,
  buildEngineWordBaseline,
  buildProtectedBaseline,
  expandClaimLedger,
  signatureFor,
  verifySignature,
} from "../scripts/frontend-content-baseline";

const fixture = JSON.parse(readFileSync(
  fileURLToPath(new URL("./fixtures/frontend-content-baseline.json", import.meta.url)),
  "utf8",
));

const protectedNavigationFollowup20260829 = {
  overview: { sha256: "6092e9ad6e96192fa4231c252742255c241a219d0971a01175148867848c311e", strings: 1108, words: 4034 },
  research: { sha256: "8b15df244bc60c81c62c55c4600788d1271996be679c031fce1b4d92809786c7", strings: 2274, words: 13065 },
};
const protectedRequest20260830 = {
  overview: { sha256: "cb7b0fe239a9cb3ffe4afe549616eb4736b45f3a20c4fac0fd7909265a3c4d45", strings: 1108, words: 4036 },
  research: { sha256: "8b15df244bc60c81c62c55c4600788d1271996be679c031fce1b4d92809786c7", strings: 2274, words: 13065 },
  execution: { sha256: "c8663f8dbbae4444b4f0c3460ca094ebd35f9d75070739141b5107d3e31c8da6", strings: 1273, words: 4515 },
  portfolio: { sha256: "bf8f95da103fffaf74390b8843d55b1190356a28084cbf18c32038d94b81e099", strings: 1117, words: 4612 },
  risk: { sha256: "743239ba25c6ff04aa762e7764f48fae72cc54b118400b3564b02f5c920634d4", strings: 966, words: 4319 },
  data: { sha256: "b5d5bdaae8658908e256103565b7beffd544edbcff6f2f1b95eb605688ead5c9", strings: 1601, words: 5859 },
  reliability: { sha256: "20e0ad90a1ab340b0fa98d3e5d880d63b780a827ef9e5f389198ac684c9c9547", strings: 1528, words: 5962 },
  developer: { sha256: "4d75452a08f93fff600e83f387a62537570f5c91dc6fd251539bd4a43a5deda7", strings: 1655, words: 6869 },
};
const protectedRuntimeIntegrity20260831 = {
  overview: { sha256: "4fb5f86a3afd6d1af95a713318120dfcc5165be1a42e50b25665676bd706c452", strings: 1120, words: 4071 },
  research: { sha256: "e597db6c76d13ca55abb7b207bdc0e1b5c131684e38a102c598f89dc2e256d15", strings: 2289, words: 13179 },
  execution: { sha256: "7b6d8ac3fc9ac6c118aec85fba6816ede78a364a9109bb4059c2ff39f737a4a6", strings: 1284, words: 4554 },
  portfolio: { sha256: "503883502acc4d8de0de3a507a2e6e5815f98a18e4211c4589b2e59af07ba022", strings: 1123, words: 4640 },
  risk: { sha256: "a83ef5f4de032820920118574087908b5ac56258ab507534b3e4fbee24945ecb", strings: 972, words: 4347 },
  data: { sha256: "cfe2f87050419ee8298bbfc424495af23b8a5b311dd80411e8124f0bdb0cdac9", strings: 1565, words: 5725 },
  reliability: { sha256: "1e3c613de9e44a512318cf689e7bd327fd0f9a534b1709217380ddc5be09872d", strings: 1540, words: 6013 },
  developer: { sha256: "a2e3838597a556fa770ef9c09f53a04ea3f58b24246c51ca26f8a6712e657064", strings: 1624, words: 6748 },
};
const protectedFrontendSweep20260831 = {
  overview: { sha256: "df70a2b59f1f6a91ca9a3cfc447f1c35e5a529a1331d41244a5bc53e8f55ab62", strings: 1120, words: 4075 },
  research: { sha256: "c40adc0e7665b3ebf4be5a7ed292e79200628ade4cba9f877af93349e035eb09", strings: 2293, words: 13194 },
  execution: { sha256: "21ec3e89d799f67df5aae3d87e7fbc07fc00d53d96ebbc77c230394ec088230e", strings: 1285, words: 4560 },
  portfolio: { sha256: "89c04c80e59840d50dc71868911af6a90ba20d1b6e417f3578e2df9bb0601f19", strings: 1123, words: 4644 },
  risk: { sha256: "609d199ef8a49345b83d3c9cdac50351761cf7241d8f79aa434550dc1898fe5b", strings: 973, words: 4352 },
  data: { sha256: "e565b31cb5e249825e203b3c3fdbdea6d050f45949118dfbd4dd4f279fb3b497", strings: 1565, words: 5729 },
  reliability: { sha256: "11437f9adfe4bb5b8f491e8133db09e101bc01064acaf260ec8a47fc1dea8158", strings: 1541, words: 6023 },
  developer: { sha256: "2265b1f6e2a17fea901e597a767991fccc5806eb33acbda9c77f1e1c1b38a3cb", strings: 1627, words: 6731 },
};

describe("the protected eight keep their signed history and current static-copy multisets", () => {
  const current = buildProtectedBaseline();

  it("retains the signed Phase 0 baseline separately", () => {
    assert.equal(fixture.version, 3);
    assert.deepEqual(fixture.protectedPhase0, {
      overview: { sha256: "61d32b9742453bd69bb9a87c39bb52092e0fb96acd949caf3f3766dfd43a74c7", strings: 1084, words: 3879 },
      research: { sha256: "661a4096f44e9f26b7f8695395c679cf312c9064ccb753f81ce24dc18445ded9", strings: 2260, words: 12922 },
      execution: { sha256: "b5b1812231dd070ab82ba239061d54d56e6462a3130ac32787672bd4fd2240c4", strings: 1245, words: 4306 },
      portfolio: { sha256: "3d530a84470168b19caf6f877a3d1fd8285fd12eeff220a757acd303e64b58ad", strings: 1100, words: 4463 },
      risk: { sha256: "8cd8e4bfd6039a13590e1b72f8724dc2e404e4806ad6682d80701404972ba8ff", strings: 945, words: 4164 },
      data: { sha256: "c933731f1ea1345943ffa91086258df6a815bedb0800abf934fb011a7f84f361", strings: 1576, words: 5709 },
      reliability: { sha256: "b10f7f5a206ddd744aa10bf823ff6374169d644f1a302aeeb90193352625cdb3", strings: 1505, words: 5817 },
      developer: { sha256: "c3e1da0022790e7098b221ad14989625d9a691800e9c8c5503634298832ae03e", strings: 1639, words: 6730 },
    });
  });

  it("retains the signed protected checkpoint and records the navigation-copy follow-up separately", () => {
    assert.deepEqual(fixture.protectedNavigationFollowup20260829, protectedNavigationFollowup20260829);
    assert.deepEqual(fixture.protectedRequest20260830, protectedRequest20260830);
    assert.deepEqual(fixture.protectedRuntimeIntegrity20260831, protectedRuntimeIntegrity20260831);
    assert.deepEqual(fixture.protectedFrontendSweep20260831, protectedFrontendSweep20260831);
    assert.deepEqual(current.signatures, {
      ...fixture.protected,
      ...protectedNavigationFollowup20260829,
      ...protectedRequest20260830,
      ...protectedRuntimeIntegrity20260831,
      ...protectedFrontendSweep20260831,
    });
  });

  it("covers every protected destination through a non-empty import closure", () => {
    assert.deepEqual(Object.keys(current.signatures), [
      "overview", "research", "execution", "portfolio",
      "risk", "data", "reliability", "developer",
    ]);
    for (const [tab, strings] of Object.entries(current.corpora)) {
      assert.ok(strings.length > 20, `${tab} produced too little copy to guard`);
    }
  });

  it("detects a dropped repeated string and a one-word rewrite", () => {
    const original = current.corpora.overview;
    const repeated = original.find((value, index) => original.indexOf(value) !== index);
    assert.ok(repeated, "the corpus lost multiset coverage; no repeated copy was found");
    const expected = signatureFor(original);
    const dropped = original.filter((value, index) => value !== repeated || index !== original.indexOf(value));
    const changed = original.map((value, index) => index === 0 ? `${value} changed` : value);
    assert.throws(() => verifySignature(expected, signatureFor(dropped)), /static copy changed/);
    assert.throws(() => verifySignature(expected, signatureFor(changed)), /static copy changed/);
  });
});

describe("the engine surface has one canonical seventy-one-view inventory", () => {
  const inventory = buildEngineInventory();

  it("pins 26 Markets, 29 Proofs and 16 Diffusion views", () => {
    assert.deepEqual(inventory, fixture.engineViews);
    const count = (product: string) => inventory.filter((entry) => entry.product === product).length;
    assert.deepEqual({ markets: count("markets"), proofs: count("proofs"), diffusion: count("diffusion") },
      { markets: 26, proofs: 29, diffusion: 16 });
  });

  it("gives every view a unique route and expanded claim-ledger entry", () => {
    assert.equal(new Set(inventory.map((entry) => entry.id)).size, 71);
    assert.equal(new Set(inventory.map((entry) => entry.deepLink)).size, 71);
    const ledger = expandClaimLedger(fixture.claimDefaults, fixture.claimSections, inventory);
    assert.equal(ledger.length, 71);
    for (const entry of ledger) {
      assert.ok(entry.decisionQuestion && entry.requiredTerms.length >= 2, `${entry.id} has no claim baseline`);
      assert.ok(entry.formulae.length && entry.unitTimeBasis, `${entry.id} lacks method or unit coverage`);
      assert.ok(entry.states.includes("unavailable"), `${entry.id} omits unavailable-state semantics`);
    }
  });
});

describe("engine copy has a reproducible source-static word baseline", () => {
  const signedPhase0 = {
    markets: { sha256: "ace12b9ccdbd29949cea29e63139131957c99c0764f46592a18ae9815c010819", strings: 1745, words: 8592 },
    proofs: { sha256: "f30a6cea80e3d72a265b0e7cb96f76eddf0ee2c0a7a6492e7ba4e16c43608a1a", strings: 2034, words: 14083 },
    diffusion: { sha256: "c28a02f21976c56aa3b98c6d9c866b4f2813cf9e43f69b21c01b98edf58714eb", strings: 1650, words: 9818 },
  };
  const signedPostUpgradeCheckpoint = {
    markets: { sha256: "230597ceeabccf4eb21cc5be7a1db720bc7ea48deccef1b6281eb98092852c35", strings: 1954, words: 9535 },
    proofs: { sha256: "f7fb6a099b0bfa8aead8831c2e3524d805b3e19ea5bc99144e52984781eddc42", strings: 2144, words: 14429 },
    diffusion: { sha256: "dd784a8c68928ad80c503aa3de21362035144244fde54b81f366c1debdfc0823", strings: 1781, words: 10302 },
  };
  const masterPlanExecutionCheckpoint = {
    // The requested order-book, Brier, Fréchet and absorption inspection
    // surfaces add explicit readout/provenance copy. The serverless resilience
    // slice also adds the deterministic snapshot strings that become visible
    // only when the gateway cannot answer. Keep this execution signature
    // separate from both signed historical checkpoints above; neither signed
    // core-eight corpus nor either historical engine checkpoint is replaced.
    markets: { sha256: "3757e5acf06a6a112c6ab26a9ec916d128bff1868bea21ae620bbf4c97c15ddd", strings: 2360, words: 10139 },
    proofs: { sha256: "1d64c63b9ee154e8578ebc137c0e82dca5063a888db9cae4834f4969a0d18724", strings: 2632, words: 15671 },
    diffusion: { sha256: "66ebbc0da0b6646853f230552a00fa8782254d024f0b0d7bbb5aac65e2528bab", strings: 2159, words: 10972 },
  };
  const request20260829Checkpoint = {
    markets: { sha256: "6b06b552c3b6670d5b315fbc1e52c74fc36d6c4372af0aa6ddee95eca0e56191", strings: 2653, words: 10884 },
    proofs: { sha256: "66ae0a8ef66b15ea403503ae27f32b16dfccdb2c60bb31cf9643b7c8c1d5a28d", strings: 2782, words: 16034 },
    diffusion: { sha256: "fa5cbbd78c32ca61834c21df88643fccb3c7293f15421aa507e3f8e0be0ed3b1", strings: 2163, words: 10977 },
  };
  const request20260830Checkpoint = {
    markets: { sha256: "91a0cac123598745457107551ba5dac3ce93092efef0c142dba5823913f8fe10", strings: 2576, words: 10445 },
    proofs: { sha256: "87e50e17bf7e9357b6a8f3f20ea0d29297f4db0325eb0048310f3aee531de5a8", strings: 2789, words: 15872 },
    diffusion: { sha256: "d7cae74df20eacd37fb30c44d4b04ade27e029cd3bdfcaa9ca3af17a34660768", strings: 2118, words: 10988 },
  };
  const runtimeIntegrity20260831Checkpoint = {
    markets: { sha256: "12a7d7a9cb29e78102e95fe570a768047065a68cd5a8c751ab37b15f1559fb54", strings: 2435, words: 9624 },
    proofs: { sha256: "ec64edeb2990587dbf37517fd6cd5837ee66e864421534d1be0d4822241446a9", strings: 2853, words: 16122 },
    diffusion: { sha256: "e4b13f71689304424e71d75cdd143eefae7ba26b6d681bbc11855c2b0b2deb84", strings: 1893, words: 10485 },
  };
  const marketsVisualRepair20260831Checkpoint = {
    // Settlement state styling, the operated Books identity lab, and the
    // actionable private-channel setup state deliberately change Markets copy.
    // Preserve the runtime-integrity checkpoint above as history.
    markets: { sha256: "191cbef02d99431e34d1892de61f9c8e8846281761f6865515f5f651a3cdb50f", strings: 2489, words: 9804 },
    proofs: { sha256: "ec64edeb2990587dbf37517fd6cd5837ee66e864421534d1be0d4822241446a9", strings: 2853, words: 16122 },
    diffusion: { sha256: "e4b13f71689304424e71d75cdd143eefae7ba26b6d681bbc11855c2b0b2deb84", strings: 1893, words: 10485 },
  };
  const interfaceClarity20260831Checkpoint = {
    // The parlay task split and the shortened Diffusion reading deliberately
    // reduce visible copy. Keep every earlier checkpoint above as history.
    markets: { sha256: "191cbef02d99431e34d1892de61f9c8e8846281761f6865515f5f651a3cdb50f", strings: 2489, words: 9804 },
    proofs: { sha256: "c89d8bd337114f7d0c2928c42cb871eff1b2f9b1b2759ed5603f52cb8107b9dc", strings: 2834, words: 15932 },
    diffusion: { sha256: "a7578a857035aaee47019c005bd7556143faf3ad090d81ebcb97c2f3515eacd4", strings: 1889, words: 10407 },
  };
  const frontendSweep20260831Checkpoint = {
    // Shared evidence ownership, recovery boundaries and the final diagram
    // sweep change the source closure without replacing any prior checkpoint.
    markets: { sha256: "304b4b0b54f0dae406f2199223946e4558a0e18dbef71578a77522e3bf86e3ca", strings: 2608, words: 9987 },
    proofs: { sha256: "d619d1dffa4f3e5b6b2e46d5b79956fd02d88a41f0ec0f5fb4c8a61ddac0f332", strings: 2923, words: 16266 },
    diffusion: { sha256: "ccea658d38eb61446dee34e9e9e5a5da27ed2a16cba3a77230edcaea82f68e65", strings: 1891, words: 10416 },
  };
  const diagramGatewayRepair20260831Checkpoint = {
    // Explicit terminal diagram states add only the reason a drawing is
    // withheld; the prior sweep remains the signed pre-repair checkpoint.
    markets: { sha256: "da02b12d04775574540861ca31d4adb8e23d997a51477e619c179323dfe8d863", strings: 2618, words: 10067 },
    proofs: { sha256: "13998ca9673651ac007e5c1da51966f6f529b8e2a6c713289ee7846800cc96fc", strings: 2930, words: 16327 },
    diffusion: { sha256: "ccea658d38eb61446dee34e9e9e5a5da27ed2a16cba3a77230edcaea82f68e65", strings: 1891, words: 10416 },
  };
  const uiCorrection20260831Checkpoint = {
    // The requested UI repair removes the obsolete per-configuration sentence
    // and adds the signed-spectrum layout vocabulary. Keep the pre-repair
    // checkpoint above intact so this remains an auditable progression.
    markets: { sha256: "a5e59a079860aa32f8cd5d0c6855f050976a3b9772f3160630ecf06acb45b2ac", strings: 2622, words: 10106 },
    proofs: { sha256: "13998ca9673651ac007e5c1da51966f6f529b8e2a6c713289ee7846800cc96fc", strings: 2930, words: 16327 },
    diffusion: { sha256: "e5cba74b4a9a46b83bfb7b0d3ad0ec9c8b4b0fccea5b8b1339f6d5515ac59afe", strings: 1894, words: 10419 },
  };

  it("retains Phase 0 and records the current upper bound as a separate signature", () => {
    assert.equal(fixture.wordBaseline.browserObserved, false);
    assert.equal(fixture.wordBaseline.method, "source-static import-closure upper bound");
    assert.deepEqual(fixture.wordBaseline.phase0Tabs, signedPhase0,
      "the signed Phase-0 engine baseline was overwritten instead of retained");
    assert.deepEqual(fixture.wordBaseline.postUpgradeTabs, signedPostUpgradeCheckpoint,
      "the signed post-upgrade checkpoint was overwritten instead of retained");
    assert.deepEqual(fixture.wordBaseline.masterPlanTabs, masterPlanExecutionCheckpoint,
      "the master-plan checkpoint was overwritten instead of retained");
    assert.deepEqual(fixture.wordBaseline.request20260829Tabs, request20260829Checkpoint);
    assert.deepEqual(fixture.wordBaseline.request20260830Tabs, request20260830Checkpoint);
    assert.deepEqual(fixture.wordBaseline.runtimeIntegrity20260831Tabs, runtimeIntegrity20260831Checkpoint);
    assert.deepEqual(fixture.wordBaseline.marketsVisualRepair20260831Tabs, marketsVisualRepair20260831Checkpoint);
    assert.deepEqual(fixture.wordBaseline.interfaceClarity20260831Tabs, interfaceClarity20260831Checkpoint);
    assert.deepEqual(fixture.wordBaseline.frontendSweep20260831Tabs, frontendSweep20260831Checkpoint);
    assert.deepEqual(fixture.wordBaseline.diagramGatewayRepair20260831Tabs, diagramGatewayRepair20260831Checkpoint);
    assert.deepEqual(fixture.wordBaseline.uiCorrection20260831Tabs, uiCorrection20260831Checkpoint);
    assert.deepEqual(buildEngineWordBaseline(), uiCorrection20260831Checkpoint);
  });

  it("retains the historical starting points for the product-specific summary-copy checks", () => {
    assert.equal(fixture.wordBaseline.summaryCopy.browserObserved, false);
    assert.equal(
      fixture.wordBaseline.summaryCopy.method,
      "source-derived summary-copy checks with product-specific scopes",
    );
    const expected = { markets: 203, proofs: 2_850, diffusion: 340 };
    for (const [tab, reading] of Object.entries(fixture.wordBaseline.summaryCopy.tabs) as Array<[
      string,
      { scope: string; baselineWords: number },
    ]>) {
      assert.ok(reading.scope.length > 12, `${tab} has no measurement scope`);
      assert.equal(reading.baselineWords, expected[tab as keyof typeof expected]);
    }
  });
});
