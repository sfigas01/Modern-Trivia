---
name: Semantic provider capabilities
description: Live embeddings support is distinct from chat integration credential presence.
---

Verify actual embeddings capability separately from chat generation before declaring themed games ready.

**Why:** Live testing showed the configured Replit OpenAI chat proxy returning HTTP 400 `INVALID_ENDPOINT` for `/embeddings`, despite working chat generation and present secrets. Its managed token was not a direct OpenAI API credential. Mocked tests and secret-presence checks missed this.

**How to apply:** Use an embeddings-capable provider credential separately from the chat connection, and test a real embedding plus a full themed game. Do not disable semantic checks to make generation pass. Abort themed preparation on semantic infrastructure failure rather than purchasing more uncheckable batches.