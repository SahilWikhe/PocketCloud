import {
  OperationalMetricsRepository,
  type OperationalSnapshot,
  type SqlExecutor,
} from "@pocketcloud/platform";

export class OperationsService {
  constructor(private readonly database: SqlExecutor) {}

  getSnapshot(): Promise<OperationalSnapshot> {
    return new OperationalMetricsRepository(this.database).snapshot();
  }
}
