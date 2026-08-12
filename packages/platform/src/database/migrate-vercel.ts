import { createNeonDatabaseFromEnvironment } from "./client";
import { migrateDatabase } from "./migrations";

if (process.env.VERCEL_ENV === undefined) {
  console.info("Skipping database migrations outside a Vercel deployment.");
} else {
  const database = createNeonDatabaseFromEnvironment();
  try {
    await migrateDatabase(database);
    console.info(`PocketCloud ${process.env.VERCEL_ENV} database migrations are current.`);
  } finally {
    await database.close();
  }
}
