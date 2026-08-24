// ── Site Types ───────────────────────────────────────────────
export type SiteStatus = 'NEW' | 'ANALYZING' | 'READY' | 'BUILDING' | 'DEPLOYED' | 'FAILED';
export type SourceType = 'URL' | 'ZIP' | 'REPO';

export interface Site {
  id: string;
  orgId?: string;
  ownerId: string;
  name: string;
  slug: string;
  sourceType: SourceType;
  sourceUrl: string;
  status: SiteStatus;
  outputStack: string;
  primaryDomain?: string;
  previewUrl?: string;
  settings?: Record<string, unknown>;
  crawls?: Crawl[];
  entities?: EntityDefinition[];
  plans?: ConversionPlan[];
  stats?: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSitePayload {
  name: string;
  sourceType: SourceType;
  sourceUrl: string;
  outputStack?: string;
}

export interface Crawl {
  id: string;
  siteId: string;
  startUrl: string;
  maxDepth: number;
  status: string;
  pagesCrawled: number;
  assetsDiscovered: number;
  durationMs?: number;
  errors?: Record<string, unknown>;
  createdAt: string;
}

export interface EntityDefinition {
  id: string;
  siteId: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  isSystem: boolean;
  version: number;
  status: string;
  fields: FieldDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface FieldDefinition {
  id: string;
  entityId: string;
  name: string;
  slug: string;
  type: string;
  isRequired: boolean;
  isUnique: boolean;
  defaultValue?: unknown;
  validationRules?: Record<string, unknown>;
  displayProps?: Record<string, unknown>;
  helpText?: string;
  order: number;
  createdAt: string;
}

export interface ConversionPlan {
  id: string;
  siteId: string;
  entities: EntityDefinition[];
  dbSchema: string;
  frontendViews: Record<string, unknown>;
  backendRoutes: Record<string, unknown>;
  migrations: unknown[];
  confidenceScores?: Record<string, number>;
  aiReasoning?: string;
  notes?: string;
  version: number;
  approvedAt?: string;
  approvedBy?: string;
  createdAt: string;
}

// ── Analytics Types ──────────────────────────────────────────
export interface DashboardStats {
  totalSites: number;
  totalConversions: number;
  successRate: number;
  avgProcessingTime: number;
  sitesThisMonth: number;
  deploymentsToday: number;
}

export interface AnalyticsData {
  conversionsOverTime: { date: string; count: number }[];
  statusDistribution: { status: SiteStatus; count: number }[];
  topSourceDomains: { domain: string; count: number }[];
  processingTimes: { date: string; avgMs: number }[];
}
