import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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

describe('Wizard Component', () => {
  it('renders step 1 initially', () => {
    render(
      <BrowserRouter>
        <Wizard />
      </BrowserRouter>
    );
    expect(screen.getByTestId('step-1')).toBeInTheDocument();
    expect(screen.queryByTestId('step-2')).not.toBeInTheDocument();
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
});
