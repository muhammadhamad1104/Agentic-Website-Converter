import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Code2, Database, Table } from 'lucide-react';
import { useJobStore } from '../../../../store/jobStore';
import toast from 'react-hot-toast';

export default function Step5Approve({ onNext, onBack, jobId }: { onNext: () => void, onBack: () => void, jobId?: string | null }) {
  const { submitSchemaDecision, getJob } = useJobStore();
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [entities, setEntities] = useState<any[]>([]);
  const [rejectFeedback, setRejectFeedback] = useState('');
  const [viewMode, setViewMode] = useState<'prisma' | 'table'>('prisma');

  useEffect(() => {
    if (jobId) {
      getJob(jobId).then((job: any) => {
        const schema = job?.workerJob?.schema_proposal || {};
        const foundEntities: any[] = schema.entities || schema.models || [];
        setEntities(foundEntities);
      });
    }
  }, [jobId, getJob]);

  // Generate Prisma code preview from real entities
  const generatedPrismaSchema = entities.map(entity => {
    const name = entity.name || 'Entity';
    const fields = Array.isArray(entity.fields) ? entity.fields : [];

    let hasId = false;
    const typeMap: Record<string, string> = {
      'string': 'String',
      'integer': 'Int',
      'number': 'Float',
      'boolean': 'Boolean',
      'image': 'String',
      'text': 'String',
      'date': 'DateTime'
    };

    const fieldLines = fields.map((f: any) => {
      if (typeof f === 'string') return `  ${f}`;
      const fname = f.name || 'field';
      let ftype = f.type || f.data_type || 'String';

      // Map generic lowercase types to Prisma types
      ftype = typeMap[ftype.toLowerCase()] || ftype;
      // Capitalize first letter as fallback for Prisma
      ftype = ftype.charAt(0).toUpperCase() + ftype.slice(1);

      const isPk = f.isPk || fname.toLowerCase() === 'id';
      if (isPk) hasId = true;
      const decorators = isPk ? ' @id @default(cuid())' : '';
      return `  ${fname.padEnd(16)} ${ftype}${decorators}`;
    });

    if (!hasId) {
      fieldLines.unshift(`  id               String @id @default(cuid())`);
    }

    return `model ${name} {\n${fieldLines.join('\n')}\n  createdAt        DateTime @default(now())\n  updatedAt        DateTime @updatedAt\n}`;
  }).join('\n\n');

  const handleApprove = async () => {
    setIsApproving(true);
    try {
      if (jobId) {
        await submitSchemaDecision(jobId, 'approved');
      }
      toast.success("Schema approved! Generating application code...");
      onNext();
    } catch (err: any) {
      toast.error("Failed to submit schema decision");
      onNext();
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    setIsRejecting(true);
    try {
      if (jobId) {
        await submitSchemaDecision(jobId, 'rejected', {
          previous_schema: { entities },
          feedback_text: rejectFeedback
        });
      }
      onBack();
    } catch (err: any) {
      toast.error("Failed to submit schema rejection");
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <>
      <div className="step-header">
        <h2 className="step-title">Human Approval Gate</h2>
        <p className="step-subtitle">Please review the schema before we generate the backend code.</p>
      </div>

      <div className="step-content">
        <div style={{ maxWidth: '640px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.25rem', width: '100%' }}>

          <div style={{
            background: '#090d16',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '14px',
            overflow: 'hidden',
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{
              background: 'rgba(15, 23, 42, 0.9)',
              padding: '0.625rem 1rem',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '12px',
              color: '#94a3b8',
              fontFamily: 'monospace'
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Database size={14} style={{ color: '#818cf8' }} />
                Inferred Database Models ({entities.length})
              </span>
              <div style={{ display: 'flex', gap: '6px', background: 'rgba(0,0,0,0.4)', padding: '2px 4px', borderRadius: '6px' }}>
                <span className={`px-2 py-1 rounded cursor-pointer transition-colors ${viewMode === 'prisma' ? 'bg-indigo-500/20 text-indigo-400' : 'text-gray-500 hover:text-gray-300'}`}
                  onClick={() => setViewMode('prisma')} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Code2 size={11} /> Prisma
                </span>
                <span className={`px-2 py-1 rounded cursor-pointer transition-colors ${viewMode === 'table' ? 'bg-indigo-500/20 text-indigo-400' : 'text-gray-500 hover:text-gray-300'}`}
                  onClick={() => setViewMode('table')} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Table size={11} /> Table
                </span>
              </div>
            </div>

            <div style={{ padding: '1rem', background: '#090d16', minHeight: '280px', maxHeight: '280px', overflowY: 'auto' }}>
              {entities.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: '12px', fontFamily: 'monospace', textAlign: 'center', padding: '2rem' }}>
                  Loading Schema...
                </div>
              ) : viewMode === 'prisma' ? (
                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '12px', color: '#c084fc', whiteSpace: 'pre-wrap' }}>
                  {generatedPrismaSchema}
                </pre>
              ) : (
                <div className="flex flex-col gap-4">
                  {entities.map((entity: any, i: number) => (
                    <div key={i} className="rounded-lg border border-gray-800 overflow-hidden">
                      <div className="bg-gray-800/50 px-3 py-2 border-b border-gray-800 font-mono text-sm text-indigo-300 flex justify-between">
                        <span>{entity.name}</span>
                        <span className="text-gray-500 text-xs">{entity.fields?.length || 0} fields</span>
                      </div>
                      <table className="w-full text-left text-xs text-gray-400 font-mono">
                        <thead className="bg-gray-900/50">
                          <tr>
                            <th className="px-3 py-2 font-normal">Field</th>
                            <th className="px-3 py-2 font-normal">Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entity.fields?.map((f: any, j: number) => (
                            <tr key={j} className="border-t border-gray-800/50 hover:bg-gray-800/30">
                              <td className="px-3 py-2">{f.name}</td>
                              <td className="px-3 py-2 text-indigo-400/80">{f.type}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bg-gray-900/50 rounded-xl p-6 border border-gray-800 text-center flex flex-col gap-4">
            <div>
              <h3 className="text-lg font-medium mb-2">Does this schema look correct?</h3>
              <p className="text-gray-400 text-sm max-w-xl mx-auto">
                Once approved, the agent will generate Prisma schemas, Express routes, and React components based on this structure.
              </p>
            </div>

            <div className="flex flex-col gap-2 max-w-xl mx-auto w-full">
              <input
                type="text"
                placeholder="Optional feedback if rejecting (e.g., 'Make sure to add a User relation')"
                value={rejectFeedback}
                onChange={(e) => setRejectFeedback(e.target.value)}
                className="input input-bordered w-full text-sm bg-gray-950 border-gray-700 placeholder-gray-500"
              />
              <div className="flex gap-4 justify-center mt-2">
                <button type="button" className="btn btn-ghost text-gray-400 hover:bg-gray-500/10 hover:text-gray-300" onClick={handleReject} disabled={isRejecting}>
                  <XCircle size={18} /> {isRejecting ? 'Rejecting...' : 'Needs Changes'}
                </button>
                <button type="button" className="btn btn-primary shadow-lg shadow-indigo-500/20" onClick={handleApprove} disabled={isApproving}>
                  <CheckCircle size={18} /> {isApproving ? 'Approving...' : 'Approve & Generate'}
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

