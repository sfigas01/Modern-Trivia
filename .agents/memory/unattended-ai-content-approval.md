# Unattended AI content approval

Guardian-style generation returning a candidate does not mean that candidate is
approved. The pipeline intentionally retains `flag` results for human review,
and even a high-confidence model `pass` can miss an unstated scope or accept a
weak premise.

For any path without a human reviewer:

- Require an explicit fact-check pass, coherence and obviousness passes,
  sufficient confidence, and no unresolved medium/high static findings.
- Preserve semantic novelty checks as a separate fail-closed gate.
- Enforce caller constraints such as selected category after generation.
- Stamp approved rows with a versioned approval-policy marker. Do not infer that
  legacy AI rows passed a policy that did not yet exist.
- Never fill a themed shortfall with generic category inventory while reporting
  it as themed/generated. Report the shortfall instead.
- Solve strict-gate attrition with bounded additional candidates or better
  prompts, not by weakening approval criteria.

Real DEV baseball validation on 2026-09-19 produced only 26 approved questions
from 120 candidates. Fourteen of the earlier 40-question run had explicit
fact-check flags despite being approved, and an additional incorrect
scope-dependent answer had received a high-confidence pass. Model verdicts are
evidence, not provenance by themselves.