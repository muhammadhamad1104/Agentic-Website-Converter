import { useState } from 'react';
import { ChevronDown, ChevronRight, FileCode, Check, Copy, Loader2 } from 'lucide-react';

export interface FileChange {
  filename: string;
  path: string;
  lang: 'ts' | 'py' | 'json' | 'prisma' | 'jsx';
  additions: number;
  deletions: number;
  codeLines: Array<{ lineOld?: number; lineNew?: number; type: 'add' | 'del' | 'normal'; content: string }>;
}

interface ReviewChangesProps {
  artifacts?: Record<string, any> | null;
}

export default function ReviewChangesViewer({ artifacts }: ReviewChangesProps) {
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({});
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  // Parse REAL generated artifacts into FileChange objects
  const parseArtifacts = (rawArtifacts?: Record<string, any> | null): FileChange[] => {
    if (!rawArtifacts || Object.keys(rawArtifacts).length === 0) {
      return [];
    }

    const changes: FileChange[] = [];

    // 1. Prisma Schema
    const prismaContent = rawArtifacts.prisma_schema || rawArtifacts.dbSchema;
    if (typeof prismaContent === 'string' && prismaContent.trim()) {
      const lines = prismaContent.split('\n');
      changes.push({
        filename: 'schema.prisma',
        path: 'apps/backend/prisma',
        lang: 'prisma',
        additions: lines.length,
        deletions: 0,
        codeLines: lines.map((content, idx) => ({
          lineNew: idx + 1,
          type: 'add',
          content
        }))
      });
    }

    // 2. Real Backend / Controller Artifacts
    const backendFiles = rawArtifacts.backend || rawArtifacts.backend_files || rawArtifacts.backendRoutes || {};
    if (typeof backendFiles === 'object' && !Array.isArray(backendFiles)) {
      Object.entries(backendFiles).forEach(([filePath, content]) => {
        if (typeof content === 'string' && content.trim()) {
          const parts = filePath.split('/');
          const filename = parts.pop() || 'controller.ts';
          const path = parts.join('/') || 'apps/backend/src';
          const lines = content.split('\n');
          const ext = filename.endsWith('.py') ? 'py' : 'ts';

          changes.push({
            filename,
            path,
            lang: ext,
            additions: lines.length,
            deletions: 0,
            codeLines: lines.map((lineStr, idx) => ({
              lineNew: idx + 1,
              type: 'add',
              content: lineStr
            }))
          });
        }
      });
    }

    // 3. Real Frontend Artifacts
    const frontendFiles = rawArtifacts.frontend || rawArtifacts.frontend_files || rawArtifacts.frontendViews || {};
    if (typeof frontendFiles === 'object' && !Array.isArray(frontendFiles)) {
      Object.entries(frontendFiles).forEach(([filePath, content]) => {
        if (typeof content === 'string' && content.trim()) {
          const parts = filePath.split('/');
          const filename = parts.pop() || 'View.tsx';
          const path = parts.join('/') || 'apps/frontend/src';
          const lines = content.split('\n');

          changes.push({
            filename,
            path,
            lang: 'jsx',
            additions: lines.length,
            deletions: 0,
            codeLines: lines.map((lineStr, idx) => ({
              lineNew: idx + 1,
              type: 'add',
              content: lineStr
            }))
          });
        }
      });
    }

    // 4. Raw file dictionary map (if artifacts is a flat dict of filepath => content)
    Object.entries(rawArtifacts).forEach(([key, val]) => {
      if (['prisma_schema', 'dbSchema', 'backend', 'frontend', 'backend_files', 'frontend_files', 'backendRoutes', 'frontendViews'].includes(key)) {
        return;
      }
      if (typeof val === 'string' && val.trim() && (key.includes('/') || key.includes('.'))) {
        const parts = key.split('/');
        const filename = parts.pop() || key;
        const path = parts.join('/') || 'src';
        const lines = val.split('\n');
        let lang: 'ts' | 'py' | 'json' | 'prisma' | 'jsx' = 'ts';
        if (filename.endsWith('.prisma')) lang = 'prisma';
        else if (filename.endsWith('.py')) lang = 'py';
        else if (filename.endsWith('.json')) lang = 'json';
        else if (filename.endsWith('.tsx') || filename.endsWith('.jsx')) lang = 'jsx';

        changes.push({
          filename,
          path,
          lang,
          additions: lines.length,
          deletions: 0,
          codeLines: lines.map((lineStr, idx) => ({
            lineNew: idx + 1,
            type: 'add',
            content: lineStr
          }))
        });
      }
    });

    return changes;
  };

  const fileChanges = parseArtifacts(artifacts);

  const toggleFile = (filename: string) => {
    setOpenFiles(prev => ({ ...prev, [filename]: !prev[filename] }));
  };

  const handleCopy = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  const getLangBadge = (lang: string) => {
    switch (lang) {
      case 'ts':
      case 'jsx':
        return <span className="text-[10px] font-bold text-blue-400 bg-blue-950/60 px-1.5 py-0.5 rounded border border-blue-800">TS</span>;
      case 'py':
        return <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800">PY</span>;
      case 'prisma':
        return <span className="text-[10px] font-bold text-indigo-400 bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-800">PRISMA</span>;
      default:
        return <span className="text-[10px] font-bold text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">FILE</span>;
    }
  };

  // If no artifacts generated yet, show real loading state (NO DUMMY FAKE DATA)
  if (fileChanges.length === 0) {
    return (
      <div className="w-full bg-[#121319] border border-gray-800 rounded-xl p-8 text-center font-mono shadow-2xl">
        <div className="flex flex-col items-center justify-center gap-3">
          <Loader2 size={24} className="animate-spin text-indigo-400" />
          <h4 className="text-sm font-semibold text-gray-300">Synthesizing Real Code Artifacts...</h4>
          <p className="text-xs text-gray-500 max-w-sm">
            The agent is writing Prisma ORM models, Express API controllers, and React UI views.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-[#121319] border border-gray-800 rounded-xl overflow-hidden font-mono shadow-2xl">
      {/* Header Bar */}
      <div className="bg-[#181a24] px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileCode size={18} className="text-indigo-400" />
          <span className="text-sm font-semibold text-gray-200">Review Changes</span>
          <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
            {fileChanges.length} real files generated
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button 
            type="button"
            className="text-gray-400 hover:text-white transition-colors"
            onClick={() => {
              const allOpen = Object.keys(openFiles).length === fileChanges.length;
              if (allOpen) {
                setOpenFiles({});
              } else {
                const newOpen: Record<string, boolean> = {};
                fileChanges.forEach(c => newOpen[c.filename] = true);
                setOpenFiles(newOpen);
              }
            }}
          >
            {Object.keys(openFiles).length === fileChanges.length ? 'Collapse All' : 'Expand All'}
          </button>
        </div>
      </div>

      {/* Files List */}
      <div className="divide-y divide-gray-800/60 max-h-[420px] overflow-y-auto">
        {fileChanges.map((file) => {
          const isOpen = !!openFiles[file.filename];

          return (
            <div key={file.filename} className="bg-[#121319]">
              {/* File Header */}
              <div 
                className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-800/40 cursor-pointer select-none transition-colors"
                onClick={() => toggleFile(file.filename)}
              >
                <div className="flex items-center gap-2.5 truncate max-w-[80%]">
                  {isOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                  {getLangBadge(file.lang)}
                  <span className="text-sm font-bold text-gray-200">{file.filename}</span>
                  <span className="text-xs text-gray-500 truncate">{file.path}</span>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-xs font-semibold space-x-1.5">
                    <span className="text-emerald-400">+{file.additions}</span>
                    <span className="text-rose-400">-{file.deletions}</span>
                  </div>
                  <button 
                    type="button" 
                    className="text-gray-500 hover:text-gray-300 p-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopy(`${file.path}/${file.filename}`);
                    }}
                    title="Copy File Path"
                  >
                    {copiedPath === `${file.path}/${file.filename}` ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>

              {/* Code Diff Panel */}
              {isOpen && (
                <div className="bg-[#0e0f14] border-t border-b border-gray-800/80 py-2 text-xs overflow-x-auto">
                  {file.codeLines.map((line, idx) => {
                    const isAdd = line.type === 'add';
                    const isDel = line.type === 'del';

                    return (
                      <div 
                        key={idx}
                        className={`flex items-center px-4 py-0.5 ${
                          isAdd ? 'bg-emerald-950/40 text-emerald-300' :
                          isDel ? 'bg-rose-950/40 text-rose-300' :
                          'text-gray-400'
                        }`}
                      >
                        {/* Gutter Line Numbers */}
                        <div className="w-16 flex gap-2 select-none text-[11px] text-gray-600 shrink-0 text-right pr-4 border-r border-gray-800/60 mr-4">
                          <span className="w-6">{line.lineOld ?? ''}</span>
                          <span className="w-6">{line.lineNew ?? ''}</span>
                        </div>

                        {/* Sign */}
                        <span className="w-4 shrink-0 font-bold">
                          {isAdd ? '+' : isDel ? '-' : ' '}
                        </span>

                        {/* Content */}
                        <pre className="whitespace-pre font-mono leading-relaxed truncate">
                          {line.content}
                        </pre>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
