# Theme evaluation fixture

`contract-v1.json` is an offline, synthetic contract-regression fixture. It
contains no real factual gold labels. It contains one valid review control and
generic invalid-review-shape cases. Structural adverse mutations are exercised
in the Vitest suite against the valid review; policy behaviors are not claimed
by the fixture.

Provenance is explicit: `synthetic_contract` is not factual accuracy evidence;
`model_assisted` is not independent gold; only separately reviewed
`human_gold` holdouts can support factual accuracy claims. E1 still reports
`accuracyClaimed: false`.

The shared evidence schema can prove structural review and dimension invariants.
Freshness, content-hash/revision mismatch, and source
independence are policy checks outside the current schema and are reported as
coverage gaps rather than claimed detector results.
The fixture declares the three unavailable checks as typed top-level
`policyCoverageGaps` metadata; reports copy them in stable order.
