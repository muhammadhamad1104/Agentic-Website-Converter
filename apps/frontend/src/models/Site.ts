export interface Site {
  id: string;
  orgId?: string;
  ownerId: string;
  name: string;
  slug: string;
  sourceType: 'url' | 'zip' | 'repo';
  sourceUrl: string;
  status: 'new' | 'analyzing' | 'ready' | 'building' | 'deployed' | 'failed';
  outputStack: 'react+node' | 'vue+express';
  primaryDomain?: string;
  previewUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversionPlan {
  id: string;
  siteId: string;
  entities: EntityDefinition[];
  dbSchema: string;
  frontendViews: string[];
  backendRoutes: string[];
  migrations: string[];
  confidenceScores: Record<string, number>;
  aiReasoning: string;
  version: number;
  approvedAt?: Date;
  approvedBy?: string;
}

export interface EntityDefinition {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon?: string;
  fields: FieldDefinition[];
  isSystem: boolean;
}

export interface FieldDefinition {
  id: string;
  entityId: string;
  name: string;
  slug: string;
  type: 'string' | 'text' | 'number' | 'date' | 'datetime' | 'image' | 'file' | 'relation' | 'rich_text' | 'boolean' | 'enum' | 'json';
  isRequired: boolean;
  isUnique: boolean;
  defaultValue?: any;
  validationRules?: Record<string, any>;
  displayProps?: Record<string, any>;
  helpText?: string;
  order: number;
}
