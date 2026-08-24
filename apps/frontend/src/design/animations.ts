import type { Variants, Transition } from 'framer-motion';

/* ──────────────────────────────────────────────────────────────
   SHARED ANIMATION VARIANTS — Use these across all components
   ────────────────────────────────────────────────────────────── */

// ── Spring Configs ───────────────────────────────────────────
export const springs = {
  gentle:  { type: 'spring', stiffness: 120, damping: 20, mass: 1 },
  bouncy:  { type: 'spring', stiffness: 300, damping: 20, mass: 0.8 },
  stiff:   { type: 'spring', stiffness: 400, damping: 30, mass: 1 },
  slow:    { type: 'spring', stiffness: 80, damping: 20, mass: 1.5 },
  wobbly:  { type: 'spring', stiffness: 200, damping: 12, mass: 1 },
} as const;

// ── Easing ───────────────────────────────────────────────────
export const easings = {
  smooth: [0.4, 0, 0.2, 1],
  out:    [0, 0, 0.2, 1],
  in:     [0.4, 0, 1, 1],
  expo:   [0.16, 1, 0.3, 1],
} as const;

// ── Fade Variants ────────────────────────────────────────────
export const fadeIn: Variants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.5, ease: easings.smooth } },
  exit:    { opacity: 0, transition: { duration: 0.3 } },
};

export const fadeInUp: Variants = {
  hidden:  { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: easings.expo } },
  exit:    { opacity: 0, y: 20, transition: { duration: 0.3 } },
};

export const fadeInDown: Variants = {
  hidden:  { opacity: 0, y: -30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: easings.expo } },
  exit:    { opacity: 0, y: -20 },
};

export const fadeInLeft: Variants = {
  hidden:  { opacity: 0, x: -40 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: easings.expo } },
  exit:    { opacity: 0, x: -20 },
};

export const fadeInRight: Variants = {
  hidden:  { opacity: 0, x: 40 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: easings.expo } },
  exit:    { opacity: 0, x: 20 },
};

// ── Scale Variants ───────────────────────────────────────────
export const scaleIn: Variants = {
  hidden:  { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1, transition: springs.bouncy },
  exit:    { opacity: 0, scale: 0.9, transition: { duration: 0.2 } },
};

export const scaleInDown: Variants = {
  hidden:  { opacity: 0, scale: 1.1 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: easings.expo } },
  exit:    { opacity: 0, scale: 0.95 },
};

// ── Slide Variants ───────────────────────────────────────────
export const slideInUp: Variants = {
  hidden:  { opacity: 0, y: '100%' },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: easings.expo } },
  exit:    { opacity: 0, y: '100%', transition: { duration: 0.3 } },
};

export const slideInRight: Variants = {
  hidden:  { opacity: 0, x: '100%' },
  visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: easings.expo } },
  exit:    { opacity: 0, x: '100%', transition: { duration: 0.3 } },
};

// ── Container Stagger ────────────────────────────────────────
export const staggerContainer: Variants = {
  hidden:  { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

export const staggerContainerFast: Variants = {
  hidden:  { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.05,
    },
  },
};

export const staggerContainerSlow: Variants = {
  hidden:  { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.2,
    },
  },
};

// ── Page Transition ──────────────────────────────────────────
export const pageTransition: Variants = {
  initial:  { opacity: 0, y: 20, filter: 'blur(8px)' },
  animate:  {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.6, ease: easings.expo },
  },
  exit: {
    opacity: 0,
    y: -20,
    filter: 'blur(4px)',
    transition: { duration: 0.3 },
  },
};

// ── Card Hover ───────────────────────────────────────────────
export const cardHover = {
  rest:  { y: 0, boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 4px 24px rgba(0,0,0,0.6)' },
  hover: {
    y: -6,
    boxShadow: '0 0 0 1px rgba(99,102,241,0.4), 0 8px 40px rgba(0,0,0,0.7), 0 0 40px rgba(99,102,241,0.2)',
    transition: springs.gentle,
  },
};

// ── Button Variants ──────────────────────────────────────────
export const buttonTap = { scale: 0.96 };
export const buttonHover = { scale: 1.03, y: -1 };

// ── Number Counter ───────────────────────────────────────────
export const counterTransition: Transition = {
  duration: 2,
  ease: easings.expo,
};

// ── Orbit Animation ──────────────────────────────────────────
export const orbitVariants: Variants = {
  animate: {
    rotate: 360,
    transition: {
      duration: 20,
      repeat: Infinity,
      ease: 'linear',
    },
  },
};

// ── Pulse ────────────────────────────────────────────────────
export const pulseVariants: Variants = {
  animate: {
    scale: [1, 1.05, 1],
    opacity: [0.7, 1, 0.7],
    transition: {
      duration: 2.5,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};

// ── Typewriter placeholder ───────────────────────────────────
export const blinkVariants: Variants = {
  animate: {
    opacity: [1, 0, 1],
    transition: {
      duration: 1,
      repeat: Infinity,
      ease: 'linear',
    },
  },
};

// ── Float ────────────────────────────────────────────────────
export const floatVariants: Variants = {
  animate: {
    y: [0, -12, 0],
    transition: {
      duration: 4,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};

// ── Reveal on Scroll ─────────────────────────────────────────
export const revealVariants: Variants = {
  hidden:  { opacity: 0, y: 60, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.7, ease: easings.expo },
  },
};

// ── Glow Pulse ───────────────────────────────────────────────
export const glowPulse: Variants = {
  animate: {
    boxShadow: [
      '0 0 20px rgba(99,102,241,0.3)',
      '0 0 60px rgba(99,102,241,0.6)',
      '0 0 20px rgba(99,102,241,0.3)',
    ],
    transition: {
      duration: 3,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};

// ── Hero Text Stagger ────────────────────────────────────────
export const heroTextContainer: Variants = {
  hidden:  { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.3,
    },
  },
};

export const heroWord: Variants = {
  hidden:  { opacity: 0, y: 80, rotateX: -60 },
  visible: {
    opacity: 1,
    y: 0,
    rotateX: 0,
    transition: { duration: 0.8, ease: easings.expo },
  },
};

// ── Node Graph (LangGraph viz) ───────────────────────────────
export const nodeVariants: Variants = {
  hidden:  { opacity: 0, scale: 0, x: 0, y: 0 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    transition: { delay: i * 0.12, ...springs.bouncy },
  }),
};

export const edgeVariants: Variants = {
  hidden:  { pathLength: 0, opacity: 0 },
  visible: (i: number) => ({
    pathLength: 1,
    opacity: 1,
    transition: { delay: i * 0.15, duration: 0.8, ease: easings.expo },
  }),
};

// ── Step Wizard ──────────────────────────────────────────────
export const stepForward: Variants = {
  initial:  { opacity: 0, x: 60, filter: 'blur(4px)' },
  animate:  { opacity: 1, x: 0, filter: 'blur(0px)', transition: { duration: 0.45, ease: easings.expo } },
  exit:     { opacity: 0, x: -60, filter: 'blur(4px)', transition: { duration: 0.3 } },
};

export const stepBackward: Variants = {
  initial:  { opacity: 0, x: -60, filter: 'blur(4px)' },
  animate:  { opacity: 1, x: 0, filter: 'blur(0px)', transition: { duration: 0.45, ease: easings.expo } },
  exit:     { opacity: 0, x: 60, filter: 'blur(4px)', transition: { duration: 0.3 } },
};

// ── List Item ────────────────────────────────────────────────
export const listItem: Variants = {
  hidden:  { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: easings.expo } },
};
