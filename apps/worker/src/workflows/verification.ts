import { PocketCloudError } from "@pocketcloud/core";

export interface DeploymentVerificationOptions {
  fetch?: typeof fetch;
  timeoutMilliseconds?: number;
  maximumResponseBytes?: number;
  maximumRedirects?: number;
}

export interface VerifiedDeployment {
  publicUrl: string;
  status: number;
  contentType: string;
}

const defaultTimeoutMilliseconds = 10_000;
const defaultMaximumResponseBytes = 256 * 1024;
const defaultMaximumRedirects = 3;
const providerErrorSignatures = [
  "DEPLOYMENT_NOT_FOUND",
  "DEPLOYMENT_DISABLED",
  "This deployment cannot be found",
  "Vercel Security Checkpoint",
  "Application error: a client-side exception has occurred",
];
const requiredSecurityHeaders = [
  ["x-content-type-options", "nosniff"],
  ["content-security-policy", "default-src 'self'"],
  ["content-security-policy", "connect-src 'none'"],
  ["permissions-policy", "camera=()"],
] as const;

function verificationFailed(message: string, retryable = false): PocketCloudError {
  return new PocketCloudError({ code: "VERIFICATION_FAILED", customerMessage: message, retryable });
}

function safeHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw verificationFailed("The deployment provider returned an invalid address.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw verificationFailed("The deployment did not provide a safe HTTPS address.");
  }
  url.hash = "";
  return url;
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw verificationFailed("The deployed entry page is larger than the verification limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw verificationFailed("The deployed entry page is not valid UTF-8 HTML.");
  }
}

export async function verifyHttpsDeployment(
  candidateUrl: string,
  options: DeploymentVerificationOptions = {},
): Promise<VerifiedDeployment> {
  const fetchImplementation = options.fetch ?? fetch;
  const timeoutMilliseconds = options.timeoutMilliseconds ?? defaultTimeoutMilliseconds;
  const maximumResponseBytes = options.maximumResponseBytes ?? defaultMaximumResponseBytes;
  const maximumRedirects = options.maximumRedirects ?? defaultMaximumRedirects;
  if (
    !Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0 || timeoutMilliseconds > 60_000 ||
    !Number.isInteger(maximumResponseBytes) || maximumResponseBytes <= 0 ||
    !Number.isInteger(maximumRedirects) || maximumRedirects < 0 || maximumRedirects > 10
  ) throw new TypeError("Deployment verification limits are invalid");

  let currentUrl = safeHttpsUrl(candidateUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    for (let redirect = 0; redirect <= maximumRedirects; redirect += 1) {
      let response: Response;
      try {
        response = await fetchImplementation(currentUrl, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: { accept: "text/html,application/xhtml+xml" },
        });
      } catch {
        throw verificationFailed("PocketCloud could not reach the deployed app. Please try again.", true);
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirect === maximumRedirects) {
          throw verificationFailed("The deployed app redirected too many times.");
        }
        currentUrl = safeHttpsUrl(new URL(location, currentUrl).toString());
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        throw verificationFailed("The deployed app did not return a successful root page.");
      }
      if (response.headers.has("x-vercel-error")) {
        throw verificationFailed("The deployment provider returned an error page.");
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (contentType !== "text/html" && contentType !== "application/xhtml+xml") {
        throw verificationFailed("The deployed root did not return an HTML entry page.");
      }
      if (requiredSecurityHeaders.some(([name, value]) => !response.headers.get(name)?.toLowerCase().includes(value.toLowerCase()))) {
        throw verificationFailed("The deployed app is missing required browser isolation headers.");
      }
      const body = await readBoundedText(response, maximumResponseBytes);
      if (!/<(?:!doctype\s+html|html)(?:\s|>)/i.test(body)) {
        throw verificationFailed("The deployed root did not contain an HTML entry document.");
      }
      if (providerErrorSignatures.some((signature) => body.includes(signature))) {
        throw verificationFailed("The deployment provider returned an unexpected error page.");
      }
      return {
        publicUrl: currentUrl.toString().replace(/\/$/, ""),
        status: response.status,
        contentType,
      };
    }
    throw verificationFailed("The deployed app redirected too many times.");
  } finally {
    clearTimeout(timeout);
  }
}
