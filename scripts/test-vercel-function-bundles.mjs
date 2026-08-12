import assert from "node:assert/strict";

process.env.DATABASE_URL ??=
  "postgresql://example-pooler.us-east-2.aws.neon.tech/pocketcloud?sslmode=require";
process.env.ACTOR_HASH_SECRET ??= "test-actor-hash-secret-at-least-32-characters";
process.env.CLERK_SECRET_KEY ??= "sk_test_bundle-load-placeholder";
process.env.CLERK_PUBLISHABLE_KEY ??= "pk_test_bundle-load-placeholder";
process.env.VERCEL_REGION ??= "iad1";

const [api, queue, retention] = await Promise.all([
  import("../api/v1.js"),
  import("../api/queue/deployments.js"),
  import("../api/cron/retention.js"),
]);

assert.equal(typeof api.default, "function");
assert.equal(typeof queue.default, "function");
assert.equal(typeof retention.default, "function");

console.info("Vercel Function bundles loaded successfully");
