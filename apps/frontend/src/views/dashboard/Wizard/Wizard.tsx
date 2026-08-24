import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowLeft, Globe, FileCode, CheckCircle2, Play, GitBranch, Settings, Check } from 'lucide-react';
import Step1Input from './steps/Step1Input';
import Step2Config from './steps/Step2Config';
import Step3Crawl from './steps/Step3Crawl';
import Step4Schema from './steps/Step4Schema';
import Step5Approve from './steps/Step5Approve';
import Step6Generate from './steps/Step6Generate';
import Step7Export from './steps/Step7Export';
import Scene3D from '../../components/Scene3D/Scene3D';
import './Wizard.css';

const steps = [
  { id: 1, title: 'Input', icon: Globe },
  { id: 2, title: 'Configure', icon: Settings },
  { id: 3, title: 'Crawl', icon: FileCode },
  { id: 4, title: 'Infer Schema', icon: GitBranch },
  { id: 5, title: 'Review', icon: CheckCircle2 },
  { id: 6, title: 'Generate', icon: Play },
  { id: 7, title: 'Export', icon: Check },
];

export default function Wizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [jobId, setJobId] = useState<string | null>(null);
  const [targetUrl, setTargetUrl] = useState<string>('');
  const [siteId, setSiteId] = useState<string | null>(null);

  const handleNext = () => {
    if (currentStep < steps.length) setCurrentStep(c => c + 1);
  };

  const handleBack = () => {
    if (currentStep > 1) setCurrentStep(c => c - 1);
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1: 
        return (
          <Step1Input 
            onNext={handleNext} 
            setJobId={setJobId} 
            setTargetUrl={setTargetUrl}
            setSiteId={setSiteId}
          />
        );
      case 2: 
        return (
          <Step2Config 
            onNext={handleNext} 
            onBack={handleBack} 
            setJobId={setJobId}
            targetUrl={targetUrl}
            siteId={siteId}
          />
        );
      case 3: return <Step3Crawl onNext={handleNext} jobId={jobId} />;
      case 4: return <Step4Schema onNext={handleNext} jobId={jobId} />;
      case 5: return <Step5Approve onNext={handleNext} onBack={handleBack} jobId={jobId} />;
      case 6: return <Step6Generate onNext={handleNext} jobId={jobId} />;
      case 7: return <Step7Export jobId={jobId} />;
      default: return null;
    }
  };

  return (
    <div className="wizard-page" style={{ position: 'relative', minHeight: '100vh' }}>
      <Scene3D />
      <div className="wizard-layout" style={{ position: 'relative', zIndex: 1 }}>
        
        {/* Sidebar Stepper */}
        <aside className="wizard-sidebar glass">
          <Link to="/dashboard" className="btn btn-ghost wizard-back-btn">
            <ArrowLeft size={16} />
            Back to Dashboard
          </Link>
          
          <div className="wizard-stepper">
            {steps.map((step, index) => {
              const isActive = currentStep === step.id;
              const isPast = currentStep > step.id;
              
              return (
                <div key={step.id} className={`wizard-step ${isActive ? 'active' : ''} ${isPast ? 'past' : ''}`}>
                  <div className="wizard-step__indicator">
                    {isPast ? <Check size={14} /> : <span>{step.id}</span>}
                  </div>
                  <div className="wizard-step__content">
                    <span className="wizard-step__title">{step.title}</span>
                  </div>
                  {index < steps.length - 1 && <div className="wizard-step__line" />}
                </div>
              );
            })}
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="wizard-main">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="wizard-step-container glass-intense"
            >
              {renderStep()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
