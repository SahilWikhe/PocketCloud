import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

const outputDirectory = resolve(".vercel-functions");
await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });

const sharedOptions = {
  bundle: true,
  external: ["@vercel/queue"],
  format: "cjs",
  logOverride: {
    // Migration helpers are parsed from the platform package but tree-shaken from hosted entries.
    "empty-import-meta": "silent",
  },
  logLevel: "info",
  platform: "node",
  sourcemap: false,
  target: "node24",
};

await Promise.all([
  build({
    ...sharedOptions,
    entryPoints: ["vercel/api-handler.ts"],
    outfile: resolve(outputDirectory, "api-handler.cjs"),
  }),
  build({
    ...sharedOptions,
    entryPoints: ["vercel/deployment-queue.ts"],
    outfile: resolve(outputDirectory, "deployment-queue.cjs"),
  }),
  build({
    ...sharedOptions,
    entryPoints: ["vercel/retention-handler.ts"],
    outfile: resolve(outputDirectory, "retention-handler.cjs"),
  }),
]);
