import { buildProductionApi } from "./runtime";

const app = buildProductionApi();

const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: "0.0.0.0" });
