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
  /** Data sources with a mapper. Sources without one are never declared. */
  dataSources: AppDataSource[];
}

/** A data source whose objects go through a mapper (`<slug>.mapper.ts`). */
export interface AppDataSource {
  slug: string;
  mapper: {
    path: string;
    /** Default 'default' — a defineMapper executor. */
    export?: string;
    /** Per-object budget for `map`, in ms. Manifest parity; enforced by the executor. */
    timeoutMs?: number;
  };
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
  /** Autonomy ladder for the method's jewel. Anything past 'manual' means the
   *  jewel shadow-runs after successful human invocations. */
  autonomy?: 'manual' | 'shadow' | 'approve' | 'auto';
  /** The jewel's canary/cost dial (deployed shadowing only — testJewel never
   *  samples). Manifest parity; the tunnel doesn't enforce it. */
  sampleRate?: number;
  /** Arrival-grading window in seconds (deployed jewels.propose only).
   *  Manifest parity; the tunnel doesn't enforce it. */
  attributionWindow?: number;
  /** The method's jewel: a sibling .jewel.ts file whose export (default:
   *  'default') is a defineJewel executor. */
  jewel?: {
    path: string;
    export?: string;
    roles?: string[];
  };
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
  /** Default preview viewport for the editor and the sandbox-owned Chrome. */
  defaultPreviewMode?: 'desktop' | 'mobile';
}

/** Response from POST /_internal/v2/apps/{appId}/dev/manage/start.
 *  The dev session IS a release — sessionId and releaseId are the same UUID.
 *  Start resumes an existing dev release if one exists (no duplicate sessions).
 *  Databases are scoped to this release and persist across connect/disconnect. */
export interface DevSession {
  sessionId: string; // same value as releaseId (dev release UUID)
  releaseId: string; // same value as sessionId
  auth: {
    /** null for an anonymous request — nobody signed in. */
    userId: string | null;
    /** A role is always held by a user, so `userId` here is non-null on
     *  purpose. The SDK derives `auth.roles` by matching assignments against
     *  `auth.userId`, so a null-held assignment matches a null identity and
     *  reports a role that `requireRole` then rejects on identity. Mirrors
     *  AppRoleAssignment in @mindstudio-ai/agent, which is `string`. */
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
  /**
   * RELATIVE path (`/v2/{appId}/run?dev-preview=true`), not a URL — the consuming dashboard
   * prepends its own host. A caller with no host to prepend has nothing to show.
   */
  previewUrl?: string;
  /** The window.__MINDSTUDIO__ context object to inject into HTML. */
  clientContext: Record<string, unknown>;
  /** Null today: the route returns no user on this response. Guard before reading. */
  user: {
    id: string;
    name: string;
    email: string;
    profilePictureUrl?: string;
  } | null;
}

/**
 * Returned from GET /_internal/v2/apps/{appId}/dev/poll
 *
 * `execute` is the only type. There used to be a `get-config`, which is how the
 * platform learned this project's interface config: a round trip through this
 * queue, in the platform's own request path, with a 30-second timeout. The
 * config is PUSHED now — `readConfig()` rides `startDevSession`, and a config
 * change restarts the session — so the platform reads it off the dev release
 * like any other environment reads it off its release.
 */
export interface DevRequest {
  requestId: string;
  type: 'execute';
  authorizationToken: string;
  methodId?: string;
  methodExport?: string;
  methodPath?: string;
  input?: unknown;
  userId?: string | null;
  /** Resolved platform-side; a system invocation arrives held by the platform's
   *  system user, never by a null identity. See DevSession['auth']. */
  roleAssignments?: Array<{ userId: string; roleName: string }>;
  streamId?: string;
  /** Originating-session identity (voice/agent tool calls) — exposed by the SDK as `session`. */
  session?: {
    channel: 'voice' | 'agent';
    voiceSessionId?: string;
    threadId?: string;
    visitorId?: string;
  };
  secrets?: Record<string, string>;
  /** Run the method's jewel companion instead of the method itself (dev twin
   *  of the deployed jewelS3Key dispatch — jewels.propose in dev sessions). */
  jewel?: boolean;
  /** Run a data source's mapper (dev twin of the deployed mapperS3Key
   *  dispatch — a dev-session `add()` or `map test --dev`). `methodId` is the
   *  synthetic `datasource:<slug>`; `input` is the executor's `{ objects }`. */
  mapper?: { slug: string };
}

/** Posted to POST /_internal/v2/apps/{appId}/dev/result/{requestId} */
export interface DevResult {
  type: 'execute';
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
  type: 'execute';
  method?: string;
  status: 'processing' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  duration?: number;
  error?: string;
}
