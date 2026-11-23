export type ComponentState = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  components: {
    database: { state: ComponentState; version?: string; latencyMs?: number; error?: string };
    redis: { state: ComponentState; latencyMs?: number; error?: string };
  };
}

export interface SetupStatus {
  initialized: boolean;
  version: string;
  database: { connected: boolean; version: string | null; migrationsApplied: number | null; pendingMigrations: boolean | null };
  redis: { connected: boolean };
}
