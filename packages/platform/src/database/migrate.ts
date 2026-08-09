import { createNeonDatabaseFromEnvironment } from "./client";
import { migrateDatabase } from "./migrations";

const database = createNeonDatabaseFromEnvironment();

try {
  await migrateDatabase(database);
  console.info("PocketCloud database migrations are current.");
} finally {
  await database.close();
}
