# STE-12 Parallel Delivery Plan

This guide coordinates the `STE-12` multiplayer rooms epic across one Codex agent and one Claude agent. Read it before starting any `STE-12` child ticket, and review it again before handing off a PR.

## Source Of Truth

- Parent epic: `STE-12` - Multiplayer Rooms: room-code join, turn-based, up to 4 players.
- Full spec: Linear document "Multiplayer Rooms - Feature Spec (room-code join, turn-based, up to 4 players)".
- Active child tickets: `STE-201` through `STE-214`.
- Superseded tickets: `STE-105` through `STE-109` are canceled and should not be resumed.

Linear remains the source of truth for current status. This file records the recommended agent split and sequencing, but agents must still verify Linear status before starting.

## Agent Ownership

| Ticket    | Owner  | Order | Notes                                                                                                                 |
| --------- | ------ | ----: | --------------------------------------------------------------------------------------------------------------------- |
| `STE-201` | Claude |     1 | Extract shared answer verification. Unblocks `STE-206`.                                                               |
| `STE-202` | Codex  |     1 | Rooms schema, migration, and `RoomSnapshot` contract. Unblocks most work.                                             |
| `STE-203` | Claude |     2 | Home mode chooser and route scaffolding.                                                                              |
| `STE-205` | Codex  |     2 | `useRoom` polling hook and token storage. Do soon after `STE-202` to unblock Claude UI tickets.                       |
| `STE-204` | Codex  |     3 | Room lifecycle API. Depends on `STE-202`.                                                                             |
| `STE-207` | Claude |     3 | Host flow UI. Depends on `STE-203` and `STE-205`.                                                                     |
| `STE-208` | Claude |     4 | Join flow UI. Depends on `STE-203` and `STE-205`.                                                                     |
| `STE-209` | Claude |     5 | Lobby and `PlayerRoster`. Depends on `STE-203` and `STE-205`.                                                         |
| `STE-206` | Codex  |     4 | Server game engine. Depends on `STE-201`, `STE-202`, and `STE-204`.                                                   |
| `STE-211` | Claude |     6 | Gameplay screens. Depends on `STE-205` and `STE-209`; should reconcile with `STE-206` before final handoff.           |
| `STE-210` | Codex  |     5 | Presence, host promotion, skip turn. Depends on `STE-206`.                                                            |
| `STE-213` | Claude |     7 | Disconnect, rejoin, host-left UI. Depends on `STE-210` and `STE-211`.                                                 |
| `STE-214` | Codex  |     6 | Two-context E2E full game. Depends on `STE-206` and `STE-211`; ideally after `STE-213` if rejoin is part of the flow. |
| `STE-212` | Codex  |     7 | QR join stretch. Low priority; do only after Level 1 is stable and `STE-209` exists.                                  |

## Wave Plan

Wave 1:

- Claude starts `STE-201`.
- Codex starts `STE-202`.

Wave 2:

- Claude starts `STE-203`.
- Codex starts `STE-205` after `STE-202` lands or the contract is stable enough to build against.

Wave 3:

- Codex starts `STE-204`.
- Claude starts `STE-207`, then `STE-208`, then `STE-209` once `STE-203` and `STE-205` are merged.

Wave 4:

- Codex starts `STE-206` after `STE-201`, `STE-202`, and `STE-204` are merged.
- Claude starts `STE-211` after `STE-205` and `STE-209`; coordinate with `STE-206` before finalizing.

Wave 5:

- Codex starts `STE-210`.
- Claude starts `STE-213` after `STE-210` and `STE-211`.

Wave 6:

- Codex starts `STE-214`.
- Codex starts `STE-212` only if the stretch remains desired.

## Start Checklist

Before starting any ticket:

1. Read `AGENTS.md`, this file, the Linear child ticket, parent `STE-12`, and the linked feature spec.
2. Verify the child ticket is not `Done`, `Canceled`, or already `In Progress`.
3. Verify dependencies listed in this file and in Linear are merged or explicitly safe to build against.
4. Check `git status --short --branch`, `git worktree list`, and local branch inventory.
5. Branch from latest `main` using the repo naming rules.
6. Move the Linear issue to `In Progress`.

If a dependency is missing, stop and comment on Linear with the blocker. Do not silently begin another ticket.

## PR Handoff Checklist

Before opening or handing off a PR:

1. Sync with latest `main`.
2. Run the required tests for the ticket; run `npm test` unless explicitly blocked.
3. Update the PR description with what changed, why, tests run, and Linear ID.
4. Move the Linear issue to `In Review`.
5. Leave a Linear comment summarizing changed files, tests, trade-offs, and follow-ups.
6. Review the current status of the other `STE-12` child tickets, including tickets owned by the other agent.
7. Recommend the next ticket to start, using the order in this file and current Linear status.

The recommendation should be concrete, for example: "Next recommended for Codex: `STE-204` because `STE-202` is in review and `STE-205` is complete. Next recommended for Claude: wait for `STE-205` before starting `STE-207`."

## Stop Conditions

Stop and ask for user direction when:

- A required dependency is not merged and the ticket cannot safely proceed with mocks or stable types.
- Another active worktree is touching the same pinch-point file.
- The implementation needs a new dependency, migration, paid service, or architecture change not already approved.
- The work drifts outside the child ticket scope.
