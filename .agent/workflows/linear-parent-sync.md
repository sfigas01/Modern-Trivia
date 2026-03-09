---
description: Sync a Linear parent issue after completing a sub-issue. Run this whenever you close or complete a sub-issue that has a parentId.
---

# Linear Parent Sync

When completing a Linear sub-issue with a `parentId`, always sync the parent in the same workflow unless the user explicitly says not to.

## Required sequence

1. Update/close the sub-issue first.
2. Read all current child issues of the parent and recompute progress (`done/total` and percentage).
3. Update parent description so status, completed/open/canceled child lists, critical path, and next recommended issue are current.
4. Add a parent comment summarizing refresh with concrete counts and issue IDs.
5. If parent sync fails, do not silently skip it.
6. If parent sync fails, add a sub-issue comment stating parent sync failed and why.
7. If parent sync fails, keep sub-issue in `In Review` instead of `Done` until parent sync is resolved.
