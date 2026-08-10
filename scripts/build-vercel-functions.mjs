import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

const outputDirectory = resolve(".vercel-functions");
await mkdir(outputDirectory, { recursive: true });

const sharedOptions = {
  bundle: true,
  external: ["@vercel/queue"],
  format: "esm",
  logLevel: "info",
  platform: "node",
  sourcemap: false,
  target: "node24",
};

await Promise.all([
  build({
    ...sharedOptions,
    entryPoints: ["vercel/api-handler.ts"],
    outfile: resolve(outputDirectory, "api-handler.mjs"),
  }),
  build({
    ...sharedOptions,
    entryPoints: ["vercel/deployment-queue.ts"],
    outfile: resolve(outputDirectory, "deployment-queue.mjs"),
  }),
  build({
    ...sharedOptions,
    entryPoints: ["vercel/retention-handler.ts"],
    outfile: resolve(outputDirectory, "retention-handler.mjs"),
  }),
]);
