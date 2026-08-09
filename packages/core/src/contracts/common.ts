import { z } from "zod";

export const identifierSchema = z.string().min(1).max(200);

export const isoDateTimeSchema = z.string().refine(
  (value) => value.includes("T") && Number.isFinite(Date.parse(value)),
  "Expected an ISO 8601 date-time",
);

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, "Expected a SHA-256 digest");

export const normalizedRelativePathSchema = z.string().min(1).refine(
  (value) =>
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").some((part) => part === "" || part === "." || part === ".."),
  "Expected a normalized relative path",
);
