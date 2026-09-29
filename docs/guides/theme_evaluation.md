# Theme evaluation harness

The STE-25 E1 harness is deterministic and offline. It validates a versioned
fixture, runs evidence-contract regression separately, and invokes an injected
decision adapter with the full question content needed for evaluation. Expected
outcomes never reach the adapter. Reports and logs contain only IDs, themes,
statuses, denominators and metrics; answers, aliases, explanations and
evidence text are redacted from those outputs.

Run it with:

```sh
node --import tsx script/theme-evaluation.ts --input test/fixtures/theme-evaluation/contract-v1.json --partition holdout
```

The default CLI has no production detector adapter, so it reports explicit
coverage gaps. It cannot claim factual accuracy in E1: `accuracyClaimed` is
always false. Incomplete and failed cases remain in denominators. Duplicate
IDs, malformed fixtures, and unselected mixed tuning/holdout input are
rejected. Structural schema failures cause a nonzero CLI exit; missing adapters
do not masquerade as schema failures.

The current shared schema can validate review shape and dimension invariants.
Freshness, content-hash/revision mismatch, and source
independence policy are not representable by that schema, so the report lists
freshness, hash, and source-independence checks as explicit policy coverage
gaps copied from the fixture's typed `policyCoverageGaps` metadata. Synthetic
cases do not establish real factual labels.
