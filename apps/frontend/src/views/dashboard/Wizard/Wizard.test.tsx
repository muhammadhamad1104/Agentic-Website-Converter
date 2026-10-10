import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import Wizard from './Wizard';

// Mock all the sub-steps to simplify testing of the wizard wrapper
vi.mock('./steps/Step1Input', () => ({
  default: ({ onNext }: any) => <div data-testid="step-1"><button onClick={onNext}>Next 1</button></div>
}));
vi.mock('./steps/Step2Config', () => ({
  default: ({ onNext, onBack }: any) => <div data-testid="step-2"><button onClick={onBack}>Back 2</button><button onClick={onNext}>Next 2</button></div>
}));
vi.mock('./steps/Step3Crawl', () => ({
  default: ({ onNext }: any) => <div data-testid="step-3"><button onClick={onNext}>Next 3</button></div>
}));
vi.mock('./steps/Step4Schema', () => ({ default: ({ onNext }: any) => <button onClick={onNext}>Next 4</button> }));
vi.mock('./steps/Step5Approve', () => ({ default: ({ onNext }: any) => <button onClick={onNext}>Next 5</button> }));
vi.mock('./steps/Step6Generate', () => ({ default: ({ onNext }: any) => <button onClick={onNext}>Next 6</button> }));
vi.mock('./steps/Step7Export', () => ({ default: () => <div>Export handoff</div> }));
beforeEach(() => { window.scrollTo = vi.fn(); Element.prototype.scrollIntoView = vi.fn(); });

describe('Wizard Component', () => {
  it('renders step 1 initially', () => {
    render(
      <BrowserRouter>
        <Wizard />
      </BrowserRouter>
    );
    expect(screen.getByTestId('step-1')).toBeInTheDocument();
    expect(screen.queryByTestId('step-2')).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Website source.' })).toBeInTheDocument();
    expect(screen.queryByText('A new chapter for your website.')).not.toBeInTheDocument();
  });

  it('navigates to step 2 when next is clicked on step 1', () => {
    render(
      <BrowserRouter>
        <Wizard />
      </BrowserRouter>
    );
    
    // Initial state is step 1
    expect(screen.getByTestId('step-1')).toBeInTheDocument();
    
    // Click next
    fireEvent.click(screen.getByText('Next 1'));
    
    // Now should be on step 2
    expect(screen.getByTestId('step-2')).toBeInTheDocument();
    expect(screen.queryByTestId('step-1')).not.toBeInTheDocument();
  });

  it('navigates back to step 1 when back is clicked on step 2', () => {
    render(
      <BrowserRouter>
        <Wizard />
      </BrowserRouter>
    );
    
    // Go to step 2
    fireEvent.click(screen.getByText('Next 1'));
    expect(screen.getByTestId('step-2')).toBeInTheDocument();
    
    // Go back to step 1
    fireEvent.click(screen.getByText('Back 2'));
    expect(screen.getByTestId('step-1')).toBeInTheDocument();
  });
  it('tracks all seven stages without allowing unfinished stages to be skipped', () => {
    render(<BrowserRouter><Wizard /></BrowserRouter>);
    const rail = screen.getByRole('navigation', { name: 'Conversion stages' });
    expect(rail.querySelectorAll('li')).toHaveLength(7); expect(rail.querySelectorAll('button,a')).toHaveLength(0);
    for (let stage = 1; stage < 7; stage++) {
      expect(screen.getAllByRole('heading')).toHaveLength(1);
      expect(rail.querySelector('[aria-current="step"]')).toHaveTextContent(['Source','Settings','Capture','Structure','Review','Generate'][stage - 1]);
      fireEvent.click(screen.getByRole('button', { name: 'Next ' + stage }));
      expect(document.activeElement).toHaveClass('conversion-stage');
    }
    expect(screen.getByText('Export handoff')).toBeInTheDocument();
    expect(rail.querySelector('[aria-current="step"]')).toHaveTextContent('Export');
    expect(rail.querySelectorAll('.completed')).toHaveLength(6);
  });
});
