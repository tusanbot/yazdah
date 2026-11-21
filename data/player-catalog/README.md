# Player catalog source data

This directory is the reviewed-data intake boundary for the player catalog. It intentionally contains no fabricated player records.

## Required provenance

Every submitted player record must include:
- `source_name`: publisher or official data provider.
- `source_url`: direct URL for the record or dataset.
- `retrieved_at`: ISO-8601 timestamp.
- `license`: license or explicit permission basis allowing reuse.
- `reviewed_by`: reviewer identifier and review date.

Do not import a record unless identity, current club/role data (where used), and each gameplay attribute are supported by the cited source or explicitly marked as game-balancing values. Keep real-world facts separate from game-only ratings.

## Intake format

Use UTF-8 JSON with a top-level `players` array. The file `player-catalog.template.json` is deliberately empty. Populate it only from a permitted, attributable source. The importer should be implemented only after the live `player_catalog` table constraints and conflict key are confirmed; do not guess a conflict key or write directly to production.

## Review checklist

1. Confirm source rights and attribution requirements.
2. Check each player identity against the source.
3. Record whether each rating is source-derived or game-balanced.
4. Reject duplicate external identifiers and ambiguous identities.
5. Review a sample before importing the complete batch.
6. Preserve source URL, retrieval date, and dataset version with the imported batch.
