import { describe, expect, it } from 'vitest';
import type { ConversionJob } from '../../../types/job';
import { crawlFinished, generationFinished, hasExportArtifacts, resumeStep, schemaReady } from './workflow';

const job = (status: string, worker: Record<string, unknown> = {}) => ({
  id: 'conversion', status: 'PROCESSING', workerJob: { status, ...worker },
} as ConversionJob);

describe('Conversion stage handoffs', () => {
  it.each(['crawled', 'extracted', 'inferring_schema'])('resumes %s at structure without repeating capture', status => {
    expect(crawlFinished(job(status))).toBe(true);
    expect(resumeStep(job(status))).toBe(4);
    expect(schemaReady(job(status))).toBe(false);
  });
  it('requires finished inference and an open quality gate before review', () => {
    const schema_proposal = { entities: [{ name: 'Service' }] };
    expect(schemaReady(job('inferring_schema', { schema_proposal }))).toBe(false);
    expect(schemaReady(job('failed', { schema_proposal }))).toBe(false);
    expect(schemaReady(job('awaiting_approval', { schema_proposal, schema_quality_report: { quality_gate: 'blocked' } }))).toBe(false);
    expect(resumeStep(job('awaiting_approval', { schema_proposal, schema_quality_report: { quality_gate: 'open' } }))).toBe(5);
  });
  it('keeps generated files exportable after validation failure without claiming completion', () => {
    const failed = job('failed', { generated_artifacts: { frontend: { 'index.html': '<h1>Site</h1>' } } });
    expect(hasExportArtifacts(failed)).toBe(true);
    expect(generationFinished(failed)).toBe(false);
    expect(resumeStep(failed)).toBe(6);
  });
  it('resumes approved jobs at generation without replaying the approval request', () => {
    expect(resumeStep(job('approved'))).toBe(6);
    expect(generationFinished(job('validated'))).toBe(true);
  });
});
