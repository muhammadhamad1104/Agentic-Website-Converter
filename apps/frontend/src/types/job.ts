// ── Job / Conversion Types ───────────────────────────────────
export type JobStatus =
  | 'DRAFT'
  | 'CRAWLING'
  | 'EXTRACTING'
  | 'INFERRING'
  | 'SCHEMA_REVIEW'
  | 'GENERATING'
  | 'VALIDATING'
  | 'PACKAGING'
  | 'DONE'
  | 'FAILED'
  | 'CANCELLED';

export interface CrawlConfig {
  depth_limit: number;
  max_pages: number;
  max_assets: number;
  same_domain_only: boolean;
  follow_asset_domains: boolean;
  request_timeout_seconds: number;
  request_retries: number;
  verify_tls: boolean;
  enforce_static_source: boolean;
  resume_from_checkpoint: boolean;
  include_sitemap_seeds: boolean;
  render_js: boolean;
  render_wait_seconds: number;
  render_headless: boolean;
}

export interface SchemaEntity {
  name: string;
  slug: string;
  description: string;
  confidence: number;
  fields: SchemaField[];
}

export interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  unique?: boolean;
  description?: string;
}

export interface SchemaProposal {
  entities: SchemaEntity[];
  relationships: SchemaRelationship[];
  quality_score: number;
  ai_reasoning?: string;
}

export interface SchemaRelationship {
  from: string;
  to: string;
  type: 'one-to-many' | 'many-to-many' | 'one-to-one';
  field: string;
}

export interface TraceEvent {
  node: string;
  timestamp: number;
  status: 'running' | 'done' | 'failed';
  duration_ms?: number;
  message?: string;
  data?: Record<string, unknown>;
}

export interface ConversionJob {
  id: string;
  siteId?: string;
  inputUrl?: string;
  htmlPages?: string[];
  status: JobStatus;
  crawlConfig?: CrawlConfig;
  schemaProposal?: SchemaProposal;
  schemaDecision?: 'pending' | 'approved' | 'rejected';
  generatedArtifacts?: GeneratedArtifacts;
  validationReport?: Record<string, unknown>;
  exportManifest?: ExportManifest;
  traceEvents?: TraceEvent[];
  errors?: string[];
  pagesCrawled?: number;
  assetsDiscovered?: number;
  workerJob?: any;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedArtifacts {
  backend?: Record<string, string>;
  frontend?: Record<string, string>;
  admin?: Record<string, string>;
  migrations?: string[];
}

export interface ExportManifest {
  zip_url?: string;
  file_count?: number;
  size_bytes?: number;
  deployment_ready?: boolean;
}

export interface CreateJobPayload {
  siteId?: string;
  input_url?: string;
  html_pages?: string[];
  crawl_config?: Partial<CrawlConfig>;
}
