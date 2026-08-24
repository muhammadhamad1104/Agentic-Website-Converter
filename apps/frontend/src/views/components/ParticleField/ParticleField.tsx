import { useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Points, PointMaterial, Float, Stars } from '@react-three/drei';
import * as THREE from 'three';

// ── Inner Particle Sphere ─────────────────────────────────────
function ParticleSphere({ count = 3000 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null!);
  const { mouse } = useThree();

  const { positions, colors } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    // Monochromatic indigo tonal scale — no pink/cyan/random colors
    const colorOptions = [
      new THREE.Color('#818cf8'), // indigo-400
      new THREE.Color('#a5b4fc'), // indigo-300
      new THREE.Color('#c7d2fe'), // indigo-200
      new THREE.Color('#e0e7ff'), // indigo-100 (near-white)
    ];

    for (let i = 0; i < count; i++) {
      // Fibonacci sphere distribution for even spread
      const phi = Math.acos(-1 + (2 * i) / count);
      const theta = Math.sqrt(count * Math.PI) * phi;
      const radius = 2.5 + Math.random() * 1.5;

      positions[i * 3]     = radius * Math.cos(theta) * Math.sin(phi);
      positions[i * 3 + 1] = radius * Math.sin(theta) * Math.sin(phi);
      positions[i * 3 + 2] = radius * Math.cos(phi);

      const color = colorOptions[Math.floor(Math.random() * colorOptions.length)];
      colors[i * 3]     = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    return { positions, colors };
  }, [count]);

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;

    // Slow rotation
    ref.current.rotation.x = t * 0.05 + mouse.y * 0.1;
    ref.current.rotation.y = t * 0.08 + mouse.x * 0.1;

    // Subtle breathing
    const scale = 1 + Math.sin(t * 0.5) * 0.03;
    ref.current.scale.setScalar(scale);
  });

  return (
    <Points ref={ref} positions={positions} colors={colors} stride={3} frustumCulled={false}>
      <PointMaterial
        transparent
        vertexColors
        size={0.018}
        sizeAttenuation={true}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </Points>
  );
}

// ── Floating Ring ─────────────────────────────────────────────
function FloatingRing({ radius = 3.5, color = '#6366f1', opacity = 0.35, speed = 1 }: {
  radius?: number;
  color?: string;
  opacity?: number;
  speed?: number;
}) {
  const ref = useRef<THREE.Mesh>(null!);

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime * speed;
    ref.current.rotation.x = Math.PI / 2 + Math.sin(t * 0.3) * 0.3;
    ref.current.rotation.z = t * 0.2;
  });

  return (
    <Float speed={1.5} rotationIntensity={0.4} floatIntensity={0.5}>
      <mesh ref={ref}>
        <torusGeometry args={[radius, 0.015, 16, 120]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>
    </Float>
  );
}

// ── Floating Icosahedron ──────────────────────────────────────
function FloatingGem({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null!);

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.rotation.x = t * 0.3;
    ref.current.rotation.y = t * 0.5;
  });

  return (
    <Float speed={2} rotationIntensity={1} floatIntensity={1}>
      <mesh ref={ref} position={position}>
        <icosahedronGeometry args={[0.12, 0]} />
        <meshStandardMaterial
          color="#818cf8"
          emissive="#6366f1"
          emissiveIntensity={0.4}
          transparent
          opacity={0.7}
          wireframe
        />
      </mesh>
    </Float>
  );
}

// ── Scene ─────────────────────────────────────────────────────
function Scene() {
  return (
    <>
      <ambientLight intensity={0.15} />
      <pointLight position={[10, 10, 10]} intensity={0.4} color="#6366f1" />
      <pointLight position={[-10, -10, -10]} intensity={0.25} color="#818cf8" />

      <Stars
        radius={60}
        depth={40}
        count={1500}
        factor={3}
        saturation={0.3}
        fade
        speed={0.4}
      />

      <ParticleSphere count={4000} />

      {/* All rings use indigo family with varying opacity */}
      <FloatingRing radius={3.8} color="#6366f1" opacity={0.3} speed={0.8} />
      <FloatingRing radius={4.5} color="#818cf8" opacity={0.2} speed={0.5} />
      <FloatingRing radius={5.2} color="#a5b4fc" opacity={0.12} speed={0.3} />

      {[
        [-2, 1.5, 1],
        [2.5, -1, 0.5],
        [-1.5, -2, -1],
        [1, 2, -1.5],
        [3, 0.5, -0.5],
      ].map((pos, i) => (
        <FloatingGem key={i} position={pos as [number, number, number]} />
      ))}
    </>
  );
}

// ── Main Export ───────────────────────────────────────────────
interface ParticleFieldProps {
  className?: string;
  style?: React.CSSProperties;
}

export default function ParticleField({ className = '', style }: ParticleFieldProps) {
  return (
    <div
      className={className}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 0,
        background: 'radial-gradient(ellipse at 50% 50%, #12122e 0%, #04040a 70%)',
        ...style,
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 8], fov: 60 }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
        }}
        dpr={[1, 1.5]}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
