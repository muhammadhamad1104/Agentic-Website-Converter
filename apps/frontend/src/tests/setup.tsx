import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Runs a cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
  cleanup();
});

// Mock matchMedia for Radix UI, Framer Motion, and other libraries that rely on window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock Three.js / R3F Canvas and GSAP to avoid WebGL context issues in jsdom
vi.mock('@react-three/fiber', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    // @ts-ignore
    ...actual,
    Canvas: ({ children }: any) => <div data-testid="r3f-canvas">{children}</div>,
  };
});

vi.mock('gsap', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    // @ts-ignore
    ...actual,
    to: vi.fn(),
    from: vi.fn(),
    fromTo: vi.fn(),
    timeline: () => ({
      to: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
    }),
  };
});

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    // @ts-ignore
    ...actual,
    AnimatePresence: ({ children }: any) => <>{children}</>,
    motion: {
      div: ({ children, className, 'data-testid': testid }: any) => (
        <div className={className} data-testid={testid}>{children}</div>
      ),
      h1: ({ children, className }: any) => <h1 className={className}>{children}</h1>,
      p: ({ children, className }: any) => <p className={className}>{children}</p>,
    }
  };
});
