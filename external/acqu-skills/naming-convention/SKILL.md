---
name: naming-convention
description: Use whenever creating a Meta campaign/ad-set/ad. Enforce the {tenant}_{offer-slug}_{audience-slug}_{angle-slug}_{date}_{variant} pattern. Rename or block on violation; never publish a non-conformant name.
---
# SKILL: Naming Convention

The canonical naming pattern Acqu uses for every Meta object. Without convention, reporting is impossible — you can't filter performance by offer, audience, or angle if the names are ad-hoc. The convention IS the schema for downstream analytics.

## Purpose

Validate every campaign/ad-set/ad name being written against the standard pattern. Auto-rename when the inputs are present; BLOCK when the inputs are missing or ambiguous (force the operator to specify before the write goes to Meta).

## The pattern

```
{tenant-slug}_{offer-slug}_{audience-slug}_{angle-slug}_{yyyymmdd}_{variant}
```

- **tenant-slug** — Acqu client identifier (lowercase, hyphens). Pulled from the agent's `tenantId` resolved via `tenants.slug`.
- **offer-slug** — the offer key from `kb:offers/registry.md`. Lowercase, hyphens.
- **audience-slug** — the audience definition key from `kb:campaign-plan/{tenant}/audiences.md`. Lowercase, hyphens.
- **angle-slug** — the creative angle from `kb:creative-briefs/{date}/{angle-slug}.md`. Lowercase, hyphens.
- **yyyymmdd** — date the object was created.
- **variant** — single letter (a, b, c, …) for A/B variants. Use "a" for first version.

### Worked example

A new ad for tenant `northwind`, offer `revenue-engine`, audience `home-services-owners-east`, angle `most-agencies-test-one-ad-per-week`, on 2026-06-15, first variant:

```
northwind_revenue-engine_home-services-owners-east_most-agencies-test-one-ad-per-week_20260615_a
```

This is verbose. It is intentional. The downstream filters require it.

## Workflow

For each Meta object being written (campaign, ad-set, or ad):

1. **Pull the inputs from the launch package + the tenant context:**
   - tenant-slug from `tenants.slug` (via agent.tenantId)
   - offer-slug from the launch-package's `offer_key`
   - audience-slug from the audience definition referenced in the package
   - angle-slug from the creative brief referenced in the package
   - date = today's yyyymmdd
   - variant = first available (a unless overridden)

2. **If any input is missing** (not provided in the launch package):
   - DO NOT auto-generate a placeholder
   - DO NOT shorten the name to "fit"
   - DO raise the missing-input in an Approval — list what's missing and ask the PM to specify
   - DO block the launch until the input is provided

3. **If all inputs are present, construct the name** using underscores between segments and hyphens within segments. Verify:
   - Total length ≤ 90 characters (Meta caps at 256 but readability degrades earlier)
   - No double-underscores (a segment that collapsed to empty)
   - No spaces (must be hyphens within segments)
   - All lowercase
   - No emoji, no special chars

4. **If the constructed name is >90 chars**, ABBREVIATE the longest segment per the abbreviation rules in `kb:campaign-plan/naming-abbreviations.md`. Do NOT silently truncate. Do NOT drop segments.

5. **If the name being proposed by the launch package DOES NOT match the constructed name**:
   - This is a launch-package error
   - Auto-rename to the constructed name AND flag in the launch summary
   - Cite the convention so the next launch is corrected at the source

6. **Apply the name to ALL three levels (campaign, ad-set, ad)** consistently — same prefix, with the variant suffix differing per ad.

## Rules

- **Every segment is required.** No "we'll fill it in later" — that NEVER happens, and the unfilled segments become permanent.
- **Lowercase only.** Capital letters break filter regexes downstream. Auto-lowercase if needed; don't pass through mixed-case.
- **Hyphens WITHIN a segment, underscores BETWEEN segments.** "_home-services-owners-east_" not "home_services_owners_east" or "Home-Services-Owners-East".
- **Date format is yyyymmdd, no separators.** Sort-friendly. "20260615" not "2026-06-15" or "Jun-15-2026".
- **Variant is a single lowercase letter.** When you exceed z, move to aa/ab/ac (very rare — usually means the angle is exhausted and you should rotate it out).
- **If you can't construct a name from the provided inputs, BLOCK the launch.** Force the operator to specify. A non-conformant name is permanent in Meta and degrades reporting forever.
- **Never auto-shorten a slug to make the name "look cleaner."** The reporting downstream depends on slug stability — same offer is always the same slug.
- **Renaming an already-launched object is FORBIDDEN.** Meta keeps the old name in historical performance data; renaming creates phantom-segment confusion in reports. Live with the name you launched with.

## Output contract

The launcher's name-validation result is part of the launch's `run_summaries.highlights`:
- `name_convention_pass: true | false`
- `name_constructed: <string>`
- `name_segments: { tenant_slug, offer_slug, audience_slug, angle_slug, date, variant }`
- `name_total_chars: <int>`
- `name_auto_renamed_from: <string|null>` (if the package's proposed name was overridden)
- `missing_inputs: [<string>...]` (if any caused a block)
