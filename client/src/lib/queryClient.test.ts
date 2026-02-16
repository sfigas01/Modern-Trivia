import { describe, expect, it, vi } from "vitest";

import { apiRequest, getQueryFn } from "./queryClient";

describe("apiRequest", () => {
  it("sends JSON body and credentials for mutation requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const payload = { name: "trivia" };
    await apiRequest("POST", "/api/test", payload);

    expect(fetchMock).toHaveBeenCalledWith("/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });
  });

  it("throws formatted errors when response is not ok", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("GET", "/api/secret")).rejects.toThrow(
      "401: Unauthorized"
    );
  });
});

describe("getQueryFn", () => {
  it("returns null on 401 when configured", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const queryFn = getQueryFn<{ id: string }[]>({ on401: "returnNull" });
    const result = await queryFn({ queryKey: ["/api", "user"] } as never);
    expect(result).toBeNull();
  });

  it("throws on 401 when configured to throw", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const queryFn = getQueryFn<{ id: string }[]>({ on401: "throw" });
    await expect(queryFn({ queryKey: ["/api", "user"] } as never)).rejects.toThrow(
      "401: Unauthorized"
    );
  });
});
