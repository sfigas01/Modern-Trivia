import { describe, expect, it } from "vitest";

import { isUnauthorizedError } from "./auth-utils";

describe("isUnauthorizedError", () => {
  it("matches 401 unauthorized message format", () => {
    const error = new Error("401: User Unauthorized");
    expect(isUnauthorizedError(error)).toBe(true);
  });

  it("does not match non-401 messages", () => {
    const error = new Error("500: Internal Server Error");
    expect(isUnauthorizedError(error)).toBe(false);
  });
});
