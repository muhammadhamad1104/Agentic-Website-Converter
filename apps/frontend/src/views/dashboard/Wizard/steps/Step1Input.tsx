import { useState, useEffect } from 'react';
import { ArrowRight, Globe, UploadCloud, Loader2, XCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { motion } from 'framer-motion';
import { useSiteStore } from '../../../../store/siteStore';
import api from '../../../../services/api';
import toast from 'react-hot-toast';

interface Step1Props {
  onNext: () => void;
  setJobId: (id: string) => void;
  setTargetUrl: (url: string) => void;
  setSiteId: (id: string) => void;
}

// Strict URL validator function
const isValidTargetUrl = (val: string): boolean => {
  const trimmed = val.trim().toLowerCase();
  if (!trimmed || trimmed.length < 4) return false;

  const withoutProtocol = trimmed.replace(/^https?:\/\//, '');
  if (withoutProtocol === 'localhost' || withoutProtocol.startsWith('localhost:') || withoutProtocol.startsWith('127.0.0.1')) {
    return true;
  }

  // Must contain valid domain name + TLD extension (e.g. kubernetes.io or https://kubernetes.io)
  const domainPattern = /^([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/;
  return domainPattern.test(withoutProtocol);
};

export default function Step1Input({ onNext, setTargetUrl, setSiteId }: Step1Props) {
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<'url' | 'upload'>('url');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingSite, setIsCheckingSite] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const { createSite } = useSiteStore();

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => {
      console.log(acceptedFiles);
      setUploadProgress(0);
      const interval = setInterval(() => {
        setUploadProgress(p => {
          if (p === null || p >= 100) {
            clearInterval(interval);
            return 100;
          }
          return p + 5;
        });
      }, 100);
    },
    accept: {
      'application/zip': ['.zip'],
      'text/html': ['.html', '.htm']
    }
  });

  const isUrlValid = mode === 'url' ? isValidTargetUrl(url) : false;
  const isBlocked = !isUrlValid || !!validationError || isSubmitting || isCheckingSite;

  const handleUrlChange = (newUrl: string) => {
    setUrl(newUrl);
    setValidationError(null);
  };

  // Live debounced pre-flight verification as user types
  useEffect(() => {
    if (mode !== 'url') return;
    if (!isValidTargetUrl(url)) {
      setValidationError(null);
      setIsCheckingSite(false);
      return;
    }

    let formattedUrl = url.trim();
    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = `https://${formattedUrl}`;
    }

    setIsCheckingSite(true);
    const timer = setTimeout(async () => {
      try {
        const checkRes = await api.post('/sites/validate-url', { url: formattedUrl });
        if (checkRes.data && checkRes.data.valid === false) {
          setValidationError(checkRes.data.error || "Target site must be a static HTML/CSS/JS website.");
        } else {
          setValidationError(null);
        }
      } catch (checkErr: any) {
        const errDetail = checkErr.response?.data?.error || "Target URL is a dynamic React/SPA site or non-static HTML website.";
        setValidationError(errDetail);
      } finally {
        setIsCheckingSite(false);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [url, mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'url') {
      if (!isValidTargetUrl(url)) {
        toast.error("Please enter a valid website URL (e.g., kubernetes.io or https://books.toscrape.com)");
        return;
      }

      if (validationError) {
        toast.error(validationError);
        return;
      }

      let formattedUrl = url.trim();
      if (!/^https?:\/\//i.test(formattedUrl)) {
        formattedUrl = `https://${formattedUrl}`;
      }

      setIsSubmitting(true);
      try {
        const site = await createSite({ sourceUrl: formattedUrl, name: '', sourceType: 'URL' });
        setTargetUrl(formattedUrl);
        setSiteId(site.id);
        toast.success("Static HTML/CSS/JS site verified! Configure crawler settings.");
        onNext();
      } catch (err: any) {
        const errorMsg = err.response?.data?.error || err.response?.data?.message || err.message || "Failed to register target site";
        setValidationError(errorMsg);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="step-header">
        <h2 className="step-title">Start Site Conversion</h2>
        <p className="step-subtitle">Provide the source URL of your static HTML/CSS/JS website</p>
      </div>

      <div className="step-content">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '2.5rem' }}>
          <button
            type="button"
            className={`btn ${mode === 'url' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setMode('url')}
          >
            <Globe size={18} /> From URL
          </button>
          <button
            type="button"
            className={`btn ${mode === 'upload' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setMode('upload')}
          >
            <UploadCloud size={18} /> Upload Files
          </button>
        </div>

        {mode === 'url' ? (
          <div className="w-full max-w-lg">
            <div className="form-group">
              <label className="label">Static Website URL (HTML, CSS, JS)</label>
              <div className="input-wrapper">
                <Globe size={16} className="input-icon" />
                <input
                  type="text"
                  className={`input input--with-icon transition-colors ${
                    validationError || (url.trim() && !isUrlValid)
                      ? 'border-rose-500 bg-rose-950/20 text-rose-200 focus:border-rose-400'
                      : isUrlValid ? 'border-emerald-500 bg-emerald-950/10' : ''
                  }`}
                  placeholder="kubernetes.io or https://books.toscrape.com"
                  value={url}
                  onChange={e => handleUrlChange(e.target.value)}
                  required
                />
              </div>
              <div className="mt-2 text-xs">
                {isCheckingSite ? (
                  <p className="text-indigo-400 font-semibold flex items-center gap-1.5 mt-1 animate-pulse">
                    <Loader2 size={14} className="animate-spin text-indigo-400" /> Analyzing target website structure & framework...
                  </p>
                ) : validationError ? (
                  <div className="bg-rose-950/40 border border-rose-800/80 p-3 rounded-xl text-rose-300 font-medium flex items-start gap-2 mt-2">
                    <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-rose-200 mb-0.5">Invalid Target Website</p>
                      <p className="text-[11px] text-rose-300/90">{validationError}</p>
                    </div>
                  </div>
                ) : url.trim() && !isUrlValid ? (
                  <p className="text-rose-400 font-semibold flex items-center gap-1.5 mt-1">
                    <XCircle size={14} /> Enter complete domain URL (e.g. kubernetes.io or https://books.toscrape.com)
                  </p>
                ) : isUrlValid ? (
                  <p className="text-emerald-400 font-semibold flex items-center gap-1 mt-1">
                    <CheckCircle2 size={14} /> Verified static HTML/CSS/JS target website
                  </p>
                ) : (
                  <p className="text-gray-400 mt-1">
                    Enter a static HTML/CSS/JS website URL. Client-side React/SPA app shells are not supported.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : uploadProgress !== null ? (
          <div className="flex flex-col items-center justify-center py-12" style={{ perspective: '1000px' }}>
            <motion.div
              className="relative flex items-center justify-center mb-8"
              animate={{ rotateX: [10, -10, 10], rotateY: [0, 360] }}
              transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
              style={{ transformStyle: 'preserve-3d', width: '120px', height: '120px' }}
            >
              <div className="absolute inset-0 rounded-full border-2 border-indigo-500/30" style={{ transform: 'rotateX(75deg)', boxShadow: 'inset 0 0 20px rgba(99,102,241,0.2)' }} />
              <div className="absolute inset-0 rounded-full border-2 border-indigo-400/20" style={{ transform: 'rotateY(75deg)', boxShadow: 'inset 0 0 20px rgba(129,140,248,0.15)' }} />
              <div className="absolute inset-0 rounded-full border-2 border-indigo-300/15" style={{ transform: 'rotateZ(45deg) rotateX(45deg)', boxShadow: 'inset 0 0 20px rgba(165,180,252,0.1)' }} />

              <motion.div
                className="absolute"
                animate={{ scale: [1, 1.2, 1], opacity: [0.8, 1, 0.8] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              >
                <div className="w-12 h-12 bg-indigo-500/20 rounded-full flex items-center justify-center backdrop-blur-md border border-indigo-400/50" style={{ boxShadow: '0 0 30px rgba(99,102,241,0.6)' }}>
                  <UploadCloud size={24} className="text-indigo-200" />
                </div>
              </motion.div>
            </motion.div>

            <motion.h3
              className="text-xl font-bold mb-3 gradient-text-animated"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              Dematerializing Files...
            </motion.h3>

            <div className="w-64 bg-gray-900/80 rounded-full h-1.5 mb-3 overflow-hidden backdrop-blur-sm border border-white/5">
              <motion.div
                className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400"
                initial={{ width: 0 }}
                animate={{ width: `${uploadProgress}%` }}
                transition={{ duration: 0.3 }}
                style={{ boxShadow: '0 0 12px rgba(99, 102, 241, 0.9)' }}
              />
            </div>

            <div className="font-mono text-sm text-indigo-300 flex items-center gap-2">
              <span className="animate-pulse">●</span> {uploadProgress}% <span className="text-gray-500">/ 100%</span>
            </div>
          </div>
        ) : (
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors ${isDragActive ? 'border-indigo-500 bg-indigo-500/10' : 'border-gray-700 hover:border-gray-500'
              }`}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}
          >
            <input {...getInputProps()} />
            <UploadCloud size={48} className="mx-auto mb-4 text-gray-400" />
            <h3 className="text-xl font-medium mb-2" style={{ margin: '0 0 0.5rem 0' }}>Drop your website files here</h3>
            <p className="text-gray-400" style={{ margin: 0 }}>Supports .zip or .html files (max 50MB)</p>
          </div>
        )}
      </div>

      <div className="step-actions" style={{ justifyContent: 'flex-end' }}>
        <button
          type="submit"
          className={`btn btn-primary transition-all duration-200 px-6 py-3 font-semibold flex items-center gap-2 ${
            isBlocked ? 'cursor-prohibited-red' : 'shadow-lg shadow-indigo-500/20'
          }`}
          onClick={(e) => {
            if (isBlocked) {
              e.preventDefault();
              if (validationError) {
                toast.error(validationError);
              } else {
                toast.error("Please enter a valid static HTML/CSS/JS website URL before continuing.");
              }
            }
          }}
        >
          {isCheckingSite ? (
            <><Loader2 size={18} className="animate-spin" /> Verifying HTML/CSS/JS Site...</>
          ) : isSubmitting ? (
            <><Loader2 size={18} className="animate-spin" /> Registering...</>
          ) : (
            <>Continue to Config <ArrowRight size={18} /></>
          )}
        </button>
      </div>
    </form>
  );
}

