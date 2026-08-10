import { describe, expect, it, vi } from "vitest";

import { verifyHttpsDeployment } from "./verification";

function html(body = "<!doctype html><html><title>Ready</title></html>", init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    ...init,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'self'; connect-src 'none'",
      "permissions-policy": "camera=(), microphone=()",
      ...Object.fromEntries(new Headers(init.headers).entries()),
    },
  });
}

describe("verifyHttpsDeployment", () => {
  it("accepts a reachable HTTPS HTML root", async () => {
    const fetchImplementation = vi.fn(async () => html());
    await expect(verifyHttpsDeployment("https://app.example.com", { fetch: fetchImplementation })).resolves.toEqual({
      publicUrl: "https://app.example.com",
      status: 200,
      contentType: "text/html",
    });
    expect(fetchImplementation).toHaveBeenCalledWith(new URL("https://app.example.com"), expect.objectContaining({ method: "GET", redirect: "manual" }));
  });

  it("follows only bounded HTTPS redirects", async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://www.example.com/" } }))
      .mockResolvedValueOnce(html());
    await expect(verifyHttpsDeployment("https://app.example.com", { fetch: fetchImplementation })).resolves.toMatchObject({
      publicUrl: "https://www.example.com",
    });
    const insecureFetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://example.com" } }));
    await expect(verifyHttpsDeployment("https://app.example.com", { fetch: insecureFetch }))
      .rejects.toMatchObject({ code: "VERIFICATION_FAILED", retryable: false });
  });

  it.each([
    [new Response("not found", { status: 404, headers: { "content-type": "text/html" } }), "successful"],
    [new Response("{}", { status: 200, headers: { "content-type": "application/json" } }), "HTML"],
    [html("plain text"), "entry document"],
    [html("<!doctype html><title>DEPLOYMENT_NOT_FOUND</title>"), "error page"],
    [html("<!doctype html>", { headers: { "content-type": "text/html", "x-vercel-error": "DEPLOYMENT_NOT_FOUND" } }), "error page"],
    [new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }), "isolation headers"],
  ])("rejects unexpected provider responses", async (response, message) => {
    await expect(verifyHttpsDeployment("https://app.example.com", { fetch: async () => response }))
      .rejects.toMatchObject({ code: "VERIFICATION_FAILED", retryable: false, customerMessage: expect.stringContaining(message) });
  });

  it("bounds response bytes and maps network details to a retryable safe error", async () => {
    await expect(verifyHttpsDeployment("https://app.example.com", { fetch: async () => html("<!doctype html>".padEnd(100, "x")), maximumResponseBytes: 32 }))
      .rejects.toMatchObject({ code: "VERIFICATION_FAILED", retryable: false });
    await expect(verifyHttpsDeployment("https://app.example.com", { fetch: async () => { throw new Error("token=secret-value"); } }))
      .rejects.toSatisfy((error: unknown) => {
        expect(error).toMatchObject({ code: "VERIFICATION_FAILED", retryable: true });
        expect((error as Error).message).not.toContain("secret-value");
        return true;
      });
  });
});
