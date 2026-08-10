const apiGatewayPath = "/api/v1";

export function toFastifyUrl(url: string | undefined): string {
  if (!url) return "/";

  const parsed = new URL(url, "https://pocketcloud.invalid");
  if (parsed.pathname === apiGatewayPath) {
    const forwardedPath = parsed.searchParams.get("path")?.replace(/^\/+/, "") ?? "";
    parsed.searchParams.delete("path");
    const query = parsed.searchParams.toString();
    return `/v1${forwardedPath ? `/${forwardedPath}` : ""}${query ? `?${query}` : ""}`;
  }

  return url.replace(/^\/api(?=\/v1(?:\/|\?|$))/, "");
}
