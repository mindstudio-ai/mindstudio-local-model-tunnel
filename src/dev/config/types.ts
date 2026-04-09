// Types for the Apps v2 local dev mode feature.

/** Parsed from mindstudio.json in the project root. */
export interface AppAuthConfig {
  enabled: boolean;
  methods: string[];
  table: {
    name: string;
    columns: Record<string, string>;
  };
}

export interface AppConfig {
  appId?: string;
  name: string;
  description?: string;
  auth?: AppAuthConfig;
  roles: AppRole[];
  tables: AppTable[];
  methods: AppMethod[];
  scenarios: AppScenario[];
  interfaces: AppInterface[];
}

export interface AppRole {
  id: string;
  name?: string;
  description?: string;
}

export interface AppMethod {
  id: string;
  name: string;
  description?: string;
  path: string;
  export: string;
}

export interface AppTable {
  path: string;
  export: string;
}

export interface AppScenario {
  id: string;
  name?: string;
  description?: string;
  path: string;
  export: string;
  roles: string[];
}

export interface AppInterface {
  type: string;
  path: string;
  enabled?: boolean;
}

/** Parsed from a web interface config file (e.g. dist/interfaces/web/web.json). */
export interface WebInterfaceConfig {
  devPort?: number;
  devCommand?: string;
}

/** Response from POST /_internal/v2/apps/{appId}/dev/manage/start.
 *  The dev session IS a release — sessionId and releaseId are the same UUID.
 *  Start resumes an existing dev release if one exists (no duplicate sessions).
 *  Databases are scoped to this release and persist across connect/disconnect. */
export interface DevSession {
  sessionId: string;   // same value as releaseId (dev release UUID)
  releaseId: string;   // same value as sessionId
  branch: string;
  auth: {
    userId: string;
    roleAssignments: Array<{ userId: string; roleName: string }>;
  };
  databases: Array<{
    id: string;
    name: string;
    tables: Array<{
      name: string;
      schema: Array<{ name: string; type: string; required?: boolean }>;
    }>;
  }>;
  methods: Record<string, string>;
  webInterfaceUrl: string;
  previewUrl?: string;
  /** The window.__MINDSTUDIO__ context object to inject into HTML. */
  clientContext: Record<string, unknown>;
  user: {
    id: string;
    name: string;
    email: string;
    profilePictureUrl?: string;
  };
}

/** Returned from GET /_internal/v2/apps/{appId}/dev/poll */
export interface DevRequest {
  requestId: string;
  type: 'execute' | 'get-config';
  authorizationToken: string;
  // Present on 'execute' requests only:
  methodId?: string;
  methodExport?: string;
  methodPath?: string;
  input?: unknown;
  userId?: string | null;
  roleAssignments?: Array<{ userId: string | null; roleName: string }>;
  roleOverride?: string[];
  streamId?: string;
  secrets?: Record<string, string>;
}

/** Posted to POST /_internal/v2/apps/{appId}/dev/result/{requestId} */
export interface DevResult {
  type: 'execute' | 'get-config';
  success: boolean;
  output?: unknown;
  error?: { message: string; stack?: string };
  stdout?: string[];
  stats?: { memoryUsedBytes: number; executionTimeMs: number };
}

/** Response from POST /_internal/v2/apps/{appId}/dev/manage/sync-schema */
export interface SyncSchemaResponse {
  created: string[];
  altered: string[];
  errors: string[];
  databases: DevSession['databases'];
}

/** For request log display in the TUI. */
export interface DevRequestLogEntry {
  id: string;
  type: 'execute' | 'get-config';
  method?: string;
  status: 'processing' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  duration?: number;
  error?: string;
}
