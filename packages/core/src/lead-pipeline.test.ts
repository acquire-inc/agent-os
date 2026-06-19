// Pure unit tests for the lead pipeline (P3 + P4) — no DB, no network.
// Run: pnpm --filter @agent-os/core test:lead-pipeline
import {
  applyQualificationRules,
  computeDedupeKey,
  DISCOVERY_ACTORS,
  matchesSuppression,
  matrixForTargetType,
  normalizeDomain,
  normalizeEmail,
  normalizeLinkedinUrl,
  normalizePhone,
  selectDiscoveryActors,
  validateScoringResult,
  type RawLeadInput,
  type SuppressionEntry,
} from "./lead-pipeline.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

async function main() {
  console.log("\n[selectDiscoveryActors — strict target_type gating]");
  {
    const local = selectDiscoveryActors("local_smb").map((a) => a.key);
    assert(local.includes("apify:google-maps-scraper"), "local_smb gets google-maps");
    assert(!local.includes("apify:crunchbase-funded"), "local_smb does NOT get crunchbase (tech_funded only)");
    assert(!local.includes("apify:apollo-scraper"), "local_smb does NOT get apollo-scraper");
  }
  {
    const tf = selectDiscoveryActors("tech_funded").map((a) => a.key);
    assert(tf.includes("apify:crunchbase-funded"), "tech_funded gets crunchbase");
    assert(tf.includes("apify:apollo-scraper"), "tech_funded gets apollo-scraper");
    assert(tf.includes("apify:linkedin-jobs-scraper"), "tech_funded gets linkedin-jobs");
    assert(!tf.includes("apify:google-maps-scraper"), "tech_funded does NOT get google-maps");
  }
  {
    const creator = selectDiscoveryActors("creator").map((a) => a.key);
    assert(creator.includes("apify:instagram-creators"), "creator gets instagram");
    assert(creator.length === 1, "creator is narrowly scoped (1 actor)");
  }

  console.log("\n[matrix — the verbatim block embedded in the system prompt]");
  {
    const block = matrixForTargetType("local_smb");
    assert(/google-maps-scraper/.test(block), "matrix lists google-maps for local_smb");
    assert(!/crunchbase/.test(block), "matrix excludes crunchbase from local_smb");
  }
  {
    const tf = matrixForTargetType("tech_funded");
    assert(/apollo-scraper/.test(tf), "matrix lists apollo for tech_funded");
    assert(/crunchbase/.test(tf), "matrix lists crunchbase for tech_funded");
  }

  console.log("\n[DISCOVERY_ACTORS — registry shape]");
  {
    assert(DISCOVERY_ACTORS.length >= 4, "registry has at least 4 actors");
    const keys = new Set(DISCOVERY_ACTORS.map((a) => a.key));
    assert(keys.size === DISCOVERY_ACTORS.length, "actor keys are unique");
    for (const a of DISCOVERY_ACTORS) {
      assert(a.maxItemsPerRun > 0, `${a.key} declares a positive item cap`);
    }
  }

  console.log("\n[CR-01 — apifyRunActor matrix gate invariant (dispatch-time refusal)]");
  // The handler in apps/runner refuses dispatch when the requested actor's
  // matrix row does NOT list the tenant's active ICP target_type. This pure
  // assertion captures the truth the handler depends on: crunchbase-funded
  // for a local_smb ICP is a hard "not registered" mismatch.
  {
    const crunchbase = DISCOVERY_ACTORS.find((a) => a.key === "apify:crunchbase-funded");
    assert(crunchbase !== undefined, "crunchbase actor present in matrix");
    assert(!crunchbase!.targets.includes("local_smb"), "crunchbase targets[] excludes local_smb (dispatch must refuse)");
    assert(crunchbase!.targets.includes("tech_funded"), "crunchbase targets[] includes tech_funded (only allowed type)");
  }
  {
    const googleMaps = DISCOVERY_ACTORS.find((a) => a.key === "apify:google-maps-scraper");
    assert(googleMaps !== undefined, "google-maps actor present in matrix");
    assert(googleMaps!.targets.includes("local_smb"), "google-maps targets[] includes local_smb (dispatch must allow)");
    assert(!googleMaps!.targets.includes("tech_funded"), "google-maps targets[] excludes tech_funded (dispatch must refuse for tf)");
  }

  console.log("\n[normalization — domain/email/linkedin]");
  assert(normalizeDomain("https://www.Example.com/path") === "example.com", "domain: strip proto/www/path/case");
  assert(normalizeDomain("") === "", "domain: empty in -> empty out");
  assert(normalizeEmail("  Foo@Bar.COM  ") === "foo@bar.com", "email: trim + lowercase");
  assert(normalizeLinkedinUrl("https://www.linkedin.com/in/Hayden-Bunn/?utm=x") === "in/hayden-bunn", "linkedin: lowercase + strip host + query + trailing");

  console.log("\n[computeDedupeKey — priority order]");
  const base: RawLeadInput = { sourceActor: "test", raw: {} };
  {
    const k = computeDedupeKey({ ...base, email: "a@b.com", linkedinUrl: "https://linkedin.com/in/a", domain: "b.com" });
    assert(k === "email:a@b.com", "email wins over linkedin + domain");
  }
  {
    const k = computeDedupeKey({ ...base, linkedinUrl: "https://linkedin.com/in/a", domain: "b.com", firstName: "x", lastName: "y" });
    assert(k === "li:in/a", "linkedin used when email absent");
  }
  {
    const k = computeDedupeKey({ ...base, domain: "B.com", firstName: "X", lastName: "Y" });
    assert(k === "dn:b.com:xy", "domain+name surrogate when email + linkedin absent");
  }
  {
    const k = computeDedupeKey({ ...base, firstName: "alone" });
    assert(k === null, "insufficient signal (no email / linkedin / domain) → null");
  }
  {
    const k = computeDedupeKey({ ...base, email: "noatsign" });
    assert(k === null, "email without @ rejected (not a real email)");
  }

  console.log("\n[matchesSuppression — exact-match after normalization]");
  const supp: SuppressionEntry[] = [
    { kind: "email", value: "blocked@example.com" },
    { kind: "domain", value: "competitor.io" },
    { kind: "phone", value: "+15551234567" },
    { kind: "linkedin_url", value: "in/blocked-user" },
  ];
  assert(matchesSuppression({ ...base, email: "Blocked@Example.com" }, supp), "email match (case-insensitive)");
  assert(matchesSuppression({ ...base, domain: "https://www.Competitor.IO/sales" }, supp), "domain match through normalization");
  assert(matchesSuppression({ ...base, phone: "+15551234567" }, supp), "phone exact match");
  assert(matchesSuppression({ ...base, linkedinUrl: "https://linkedin.com/in/blocked-user/?ref=x" }, supp), "linkedin match through normalization");
  assert(!matchesSuppression({ ...base, email: "ok@example.com" }, supp), "non-match returns false");
  assert(!matchesSuppression({ ...base }, supp), "empty lead returns false");

  console.log("\n[WR-03 — normalizePhone shared between match and scrub]");
  assert(normalizePhone(null) === null, "null in → null out");
  assert(normalizePhone(undefined) === null, "undefined in → null out");
  assert(normalizePhone("   ") === null, "whitespace-only → null");
  assert(normalizePhone("(555) 123-4567") === "+15551234567", "formatted NANP → +1-prefixed e164");
  assert(normalizePhone("+1 555-123-4567") === "+15551234567", "intl with + preserves country code");
  assert(normalizePhone("+15551234567") === "+15551234567", "already-e164 unchanged");
  assert(normalizePhone("555-1234") === "5551234", "short digit string keeps no `+` (no intl assumption)");
  assert(normalizePhone("+447911123456") === "+447911123456", "non-NANP intl preserved as-is");
  // The canonical motivating case: stored as e164, arrives formatted.
  assert(
    matchesSuppression({ ...base, phone: "(555) 123-4567" }, [{ kind: "phone", value: "+15551234567" }]),
    "WR-03: formatted lead phone matches +15551234567 suppression entry",
  );
  assert(
    !matchesSuppression({ ...base, phone: "(999) 999-9999" }, [{ kind: "phone", value: "+15551234567" }]),
    "WR-03: unrelated phone does not match",
  );

  console.log("\n[validateScoringResult — strict contract]");
  {
    const r = validateScoringResult({
      score: 78,
      qualified: true,
      roiHook: "save 5h/week on lead enrichment",
      signal: "hiring 3 SDRs",
      reason: "fits ICP titles + headcount + growth signal",
    });
    assert(r.ok && r.value !== undefined, "valid scoring result accepted");
    assert(r.value!.score === 78, "score passed through");
  }
  {
    const r = validateScoringResult({ score: 150, qualified: true, roiHook: "x", signal: "y", reason: "z" });
    assert(!r.ok && r.reasons[0]!.includes("[0, 100]"), "out-of-range score rejected");
  }
  {
    const r = validateScoringResult({ score: 50.5, qualified: true, roiHook: "x", signal: "y", reason: "z" });
    assert(!r.ok && r.reasons[0]!.includes("integer"), "non-integer score rejected");
  }
  {
    const r = validateScoringResult({ score: 50, qualified: "yes", roiHook: "x", signal: "y", reason: "z" });
    assert(!r.ok && r.reasons[0]!.includes("qualified"), "non-boolean qualified rejected");
  }
  {
    const r = validateScoringResult({ score: 50, qualified: true, roiHook: "", signal: "y", reason: "z" });
    assert(!r.ok && r.reasons[0]!.includes("roiHook"), "empty roiHook rejected");
  }
  {
    const r = validateScoringResult(null);
    assert(!r.ok && r.reasons[0]!.includes("not an object"), "null rejected");
  }
  {
    const r = validateScoringResult([1, 2, 3]);
    assert(!r.ok, "array rejected (not an object)");
  }

  console.log("\n[applyQualificationRules — DNC + invalid email always disqualify]");
  {
    const d = applyQualificationRules({
      scoreThreshold: 60, score: 80, modelQualified: true,
      emailStatus: "valid", dncFlag: false,
    });
    assert(d.qualified === true, "passing score + clean → qualified");
  }
  {
    const d = applyQualificationRules({
      scoreThreshold: 60, score: 95, modelQualified: true,
      emailStatus: "valid", dncFlag: true,
    });
    assert(d.qualified === false, "DNC kills even a 95 score");
    assert(/dnc_flag/.test(d.reason), "reason names dnc");
  }
  {
    const d = applyQualificationRules({
      scoreThreshold: 60, score: 95, modelQualified: true,
      emailStatus: "invalid", dncFlag: false,
    });
    assert(d.qualified === false, "invalid email kills even a 95 score");
    assert(/email_status=invalid/.test(d.reason), "reason names invalid email");
  }
  {
    const d = applyQualificationRules({
      scoreThreshold: 60, score: 40, modelQualified: true,
      emailStatus: "valid", dncFlag: false,
    });
    assert(d.qualified === false, "below threshold → disqualified");
    assert(/below threshold/.test(d.reason), "reason explains threshold gap");
  }
  {
    const d = applyQualificationRules({
      scoreThreshold: 60, score: 80, modelQualified: false,
      emailStatus: "valid", dncFlag: false,
    });
    assert(d.qualified === false, "scorer override (qualified=false) honored despite passing score");
  }
  {
    // Boundary: score == threshold qualifies.
    const d = applyQualificationRules({
      scoreThreshold: 60, score: 60, modelQualified: true,
      emailStatus: "risky", dncFlag: false,
    });
    assert(d.qualified === true, "score == threshold qualifies (inclusive)");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
