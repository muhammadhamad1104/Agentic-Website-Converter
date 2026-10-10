import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Check, FileCode2, Globe2, GitBranch, Settings2, ScanLine, PackageCheck, FolderDown } from 'lucide-react';
import { Workspace } from '../../components/Workspace/Workspace';
import Step1Input from './steps/Step1Input';
import Step2Config from './steps/Step2Config';
import Step3Crawl from './steps/Step3Crawl';
import Step4Schema from './steps/Step4Schema';
import Step5Approve from './steps/Step5Approve';
import Step6Generate from './steps/Step6Generate';
import Step7Export from './steps/Step7Export';
import './Wizard.css';

const steps = [
  { title: 'Source', heading: 'Website', accent: 'source.', icon: Globe2 },
  { title: 'Settings', heading: 'Capture', accent: 'settings.', icon: Settings2 },
  { title: 'Capture', heading: 'Capturing', accent: 'your website.', icon: ScanLine },
  { title: 'Structure', heading: 'Content', accent: 'structure.', icon: GitBranch },
  { title: 'Review', heading: 'Review', accent: 'your schema.', icon: FileCode2 },
  { title: 'Generate', heading: 'Building', accent: 'your application.', icon: PackageCheck },
  { title: 'Export', heading: 'Your', accent: 'source files.', icon: FolderDown },
];

export default function Wizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [jobId, setJobId] = useState<string | null>(null);
  const [targetUrl, setTargetUrl] = useState('');
  const [siteId, setSiteId] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLOListElement>(null);
  const previous = useRef(currentStep);
  const activeStep = steps[currentStep - 1];
  useEffect(() => {
    if (previous.current !== currentStep) {
      stage.current?.focus({ preventScroll: true });
      stage.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
      rail.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' });
      previous.current = currentStep;
    }
  }, [currentStep]);
  const next = () => setCurrentStep(step => Math.min(7, step + 1));
  const back = () => setCurrentStep(step => Math.max(1, step - 1));
  const content = () => {
    switch (currentStep) {
      case 1: return <Step1Input onNext={next} setJobId={setJobId} setTargetUrl={setTargetUrl} setSiteId={setSiteId} />;
      case 2: return <Step2Config onNext={next} onBack={back} setJobId={setJobId} targetUrl={targetUrl} siteId={siteId} />;
      case 3: return <Step3Crawl onNext={next} jobId={jobId} />;
      case 4: return <Step4Schema onNext={next} jobId={jobId} />;
      case 5: return <Step5Approve onNext={next} onBack={back} jobId={jobId} />;
      case 6: return <Step6Generate onNext={next} jobId={jobId} />;
      case 7: return <Step7Export jobId={jobId} />;
    }
  };
  return <Workspace><div className="conversion-studio">
    <div className="conversion-context-links">
      <Link to="/dashboard" className="conversion-back"><ArrowLeft size={14} />Projects</Link>
      {siteId && <Link to={'/sites/' + siteId}>Project overview<ArrowUpRight size={13} /></Link>}
    </div>
    <header className="workspace-title conversion-title">
      <div><h1>{activeStep.heading} <em>{activeStep.accent}</em></h1>
        {targetUrl && <a className="conversion-source-url" title={targetUrl} href={targetUrl} target="_blank" rel="noreferrer">{targetUrl}</a>}</div>
    </header>
    <nav className="conversion-rail" aria-label="Conversion stages"><ol ref={rail}>
      {steps.map((step, index) => {
        const number = index + 1; const active = number === currentStep; const completed = number < currentStep;
        const Icon = completed ? Check : step.icon;
        return <li key={step.title} className={active ? 'current' : completed ? 'completed' : ''} aria-current={active ? 'step' : undefined}>
          <span className="conversion-step-icon"><Icon size={16} strokeWidth={1.5} /></span>
          <span className="conversion-step-label"><small>{String(number).padStart(2, '0')}</small>{step.title}</span>
          <span className="sr-only">{active ? ', current stage' : completed ? ', finished stage' : ', upcoming stage'}</span>
        </li>;
      })}
    </ol></nav>
    <div key={currentStep} className="conversion-stage" ref={stage} tabIndex={-1} aria-label={'Stage ' + currentStep + ': ' + steps[currentStep - 1].title}>
      {content()}
    </div>
  </div></Workspace>;
}
