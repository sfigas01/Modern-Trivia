# Multiplayer Dispute Voting

## Setup and rollout

The multiplayer host can enable **Opponent dispute voting** during room setup. The option is multiplayer-only and defaults to **off**, so existing rooms keep the manual dispute flow unless the host explicitly opts in.

Operational rollback does not require a deployment or data change: keep the option off when creating rooms. Existing finalized audit records remain available to QA.

## Voting-enabled rooms

When the active player disputes an incorrect answer, the room enters `DISPUTE_VOTE` and freezes the eligible voter list. Every other active room player is eligible; the answering/disputing player is not. The host may vote only when the host is an eligible opponent.

Each eligible player has one locked ballot. The server calculates the approval threshold as:

```text
floor(eligible voters / 2) + 1
```

- Reaching the threshold approves the dispute.
- A completed tie fails and is recorded as `tied`.
- A completed vote below the threshold is `rejected`.
- Non-responses do not count toward approval.
- The vote closes after 60 seconds. An unresolved deadline is recorded as `expired`.
- The host can cancel an open vote; cancellation is recorded as `canceled`.

Individual ballot choices stay private in the gameplay snapshot. Players see aggregate progress and their own locked-submission state.

An approval replaces the incorrect negative delta with the question's normal positive difficulty points. It is not a bonus on top of another score. Rejected, tied, expired, and canceled votes preserve the original incorrect delta. Advancement applies the final delta once.

## Voting-disabled rooms

The dispute is still synchronized and persisted, but no formal vote phase appears. Only the host receives **Group agreed — award points**. The host may use that manual award even when the host submitted the dispute; this supports correcting a problematic question. A non-host disputing player cannot award points.

## QA and admin audit

The admin dispute view distinguishes the gameplay decision from the later content-QA status. Multiplayer evidence includes:

- room code and stable attempt key;
- disputing player and submitted/expected answers;
- whether voting was enabled;
- frozen eligible-voter snapshot;
- each persisted ballot and cast time;
- explicit non-responses derived from eligibility;
- majority threshold and final outcome;
- original and final score deltas; and
- decision timestamp.

An approved gameplay dispute does not automatically change the answer key. Admins can still analyze, correct, resolve, or reject the content report independently.

## Known non-goals

- Team-level ballot aggregation beyond one room player per identity
- Simultaneous-answer voting
- AI deciding an in-game vote
- Public disclosure of individual ballot choices
- Point deductions from voters
- Guest/account identity redesign
- Changes to difficulty point values
- Enabling voting by default
- Changes to solo dispute behavior

## Verification

Run the focused multi-context acceptance suite with a migrated Postgres database:

```bash
npx playwright test e2e/multiplayer-disputes.spec.ts
```

See [E2E Testing Guide](./e2e_testing.md) for fixture requirements, repeat execution, and the full multiplayer regression command.
