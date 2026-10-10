import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, RoundedBox, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { scenePose } from './sequence';
import './CinematicScene.css';

const MEDIA = '/media/pavilion.webp';

function surface(kind: 'site' | 'content' | 'structure', image: CanvasImageSource) {
  const canvas = document.createElement('canvas');
  canvas.width = 1600; canvas.height = 1040;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f4f5f1'; ctx.fillRect(0, 0, 1600, 1040);
  const text = (label: string, x: number, y: number, size: number, color = '#23352b', weight = '400') => {
    ctx.fillStyle = color; ctx.font = `${weight} ${size}px "Manrope Variable", sans-serif`; ctx.fillText(label, x, y);
  };
  ctx.fillStyle = '#e8ece6'; ctx.fillRect(0, 0, 1600, 58);
  [28, 48, 68].forEach(x => { ctx.fillStyle = '#8e9b91'; ctx.beginPath(); ctx.arc(x, 29, 4, 0, Math.PI * 2); ctx.fill(); });
  text(kind === 'site' ? 'formandfield.studio' : kind === 'content' ? 'Workspace / Content' : 'Source / Structure', 615, 36, 16, '#68776c');
  if (kind === 'site') {
    text('FORM / FIELD', 65, 137, 30, '#22352a', '600');
    text('Studio', 1180, 135, 19); text('Projects', 1300, 135, 19); text('Contact', 1432, 135, 19);
    text('Places for possibility.', 65, 249, 68, '#1e3326', '500');
    text('Architecture, with a sense of belonging.', 66, 301, 21, '#75816f');
    ctx.drawImage(image, 65, 346, 1470, 550);
    text('01 / THE PAVILION', 65, 961, 17, '#52634f');
    text('Built around a different way of living.', 1070, 961, 17, '#52634f');
  } else if (kind === 'content') {
    ctx.fillStyle = '#23392e'; ctx.fillRect(0, 58, 280, 982);
    text('FORM / FIELD', 32, 125, 23, '#eff3e9', '500');
    ['Overview', 'Pages', 'Collections', 'Media', 'Settings'].forEach((label, i) => {
      if (i === 2) { ctx.fillStyle = '#3a5142'; ctx.fillRect(16, 305, 248, 57); }
      text(label, 37, 220 + i * 65, 20, i === 2 ? '#d8eabf' : '#a5b4a7');
    });
    text('Your content.', 335, 160, 54, '#23352b', '500');
    text('Collections', 337, 207, 19, '#71816d');
    ctx.fillStyle = '#274c36'; ctx.fillRect(1336, 117, 206, 50); text('+ New entry', 1360, 150, 18, '#f4f6ec');
    text('COLLECTION', 355, 295, 15, '#798573'); text('STATUS', 1336, 295, 15, '#798573');
    ['Projects', 'Studio', 'Services', 'People', 'Navigation'].forEach((label, i) => {
      const y = 330 + i * 119;
      ctx.fillStyle = i % 2 ? '#edf0e9' : '#fff'; ctx.fillRect(336, y, 1206, 102);
      if (i === 0) ctx.drawImage(image, 353, y + 15, 104, 72);
      else { ctx.fillStyle = '#d6dfd1'; ctx.fillRect(353, y + 15, 104, 72); text('0' + (i + 1), 380, y + 60, 25, '#597255'); }
      text(label, 485, y + 45, 25, '#2b3c2e', '500'); text('Content collection', 485, y + 75, 16, '#7a8876');
      text('Published', 1336, y + 58, 17, '#346647');
    });
    text('Your website. Your workspace.', 337, 990, 17, '#748171');
  } else {
    ctx.fillStyle = '#1c2a23'; ctx.fillRect(0, 58, 1600, 982);
    text('A structure of its own.', 65, 154, 54, '#e7eee1', '500');
    text('SOURCE / CONTENT / COLLECTIONS', 68, 211, 19, '#8fa788');
    const lines = ['website', '  pages', '    title: text', '    content: rich text', '    media: collection', '  projects', '    name: text', '    images: collection', '    featured: boolean', '  navigation'];
    lines.forEach((line, i) => {
      text(String(i + 1).padStart(2, '0'), 68, 316 + i * 61, 18, '#627667');
      text(line, 150, 316 + i * 61, 28, line.includes(':') ? '#a8ba9d' : '#e0edd3');
    });
    ctx.strokeStyle = '#3e5343'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(970, 270); ctx.lineTo(970, 938); ctx.stroke();
    text('Connected.', 1040, 330, 34, '#d5e8b8');
    ['Pages', 'Media', 'Collections'].forEach((label, i) => { ctx.strokeRect(1040, 406 + i * 144, 455, 98); text(label, 1070, 466 + i * 144, 23, '#bbcdb3'); });
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function WindowSurface({ texture, width = 6.8 }: { texture: THREE.Texture; width?: number }) {
  const height = width * .65;
  return <>
    <RoundedBox args={[width + .1, height + .1, .1]} radius={.065} smoothness={3}>
      <meshPhysicalMaterial color="#a9b7aa" metalness={.8} roughness={.22} clearcoat={.5} />
    </RoundedBox>
    <mesh position={[0, 0, .057]}><planeGeometry args={[width, height]} /><meshBasicMaterial map={texture} toneMapped={false} /></mesh>
  </>;
}

function Sequence({ progress, reduced, compact }: { progress: MutableRefObject<number>; reduced: boolean; compact: boolean }) {
  const assembly = useRef<THREE.Group>(null!);
  const site = useRef<THREE.Group>(null!);
  const structure = useRef<THREE.Group>(null!);
  const content = useRef<THREE.Group>(null!);
  const smooth = useRef(progress.current);
  const image = useTexture(MEDIA);
  const { size, invalidate } = useThree();
  const mobile = !compact && size.width < 800;
  const textures = useMemo(() => [surface('site', image.image), surface('structure', image.image), surface('content', image.image)], [image]);
  useEffect(() => {
    const refresh = () => invalidate();
    window.addEventListener('scroll', refresh, { passive: true });
    window.addEventListener('pointermove', refresh, { passive: true });
    return () => { window.removeEventListener('scroll', refresh); window.removeEventListener('pointermove', refresh); };
  }, [invalidate]);
  useEffect(() => () => textures.forEach(texture => texture.dispose()), [textures]);
  useFrame((state, delta) => {
    const target = compact ? reduced ? .12 : .15 + (Math.sin(state.clock.elapsedTime * .22) + 1) * .16 : progress.current;
    smooth.current = reduced ? target : THREE.MathUtils.damp(smooth.current, target, 7, Math.min(delta, .05));
    const pose = scenePose(smooth.current, mobile, compact);
    // Keep mobile media below the copy, including short landscape and small phones.
    if (mobile) {
      pose.y = size.height < 510 ? -3.05 : -2.4;
      pose.scale *= size.height < 510 ? .79 : 1;
    }
    const pointer = reduced || mobile ? 0 : .025;
    assembly.current.position.set(pose.x + state.pointer.x * pointer, pose.y, 0);
    assembly.current.rotation.set(pose.rx + state.pointer.y * pointer, pose.ry, pose.rz);
    assembly.current.scale.setScalar(pose.scale);
    state.camera.position.set(0, pose.cameraY, pose.cameraZ);
    state.camera.lookAt(0, 0, 0);
    const s = pose.spread; const c = pose.connected;
    site.current.position.set(s * (mobile ? .35 : 1) - c * (mobile ? 1.35 : 1.85), s * (mobile ? 1.25 : 1.9) + c * .38, s * .9 + .3);
    site.current.rotation.set(-s * .1, -c * .14, -s * .02);
    site.current.scale.setScalar(1 - s * .27 - c * (mobile ? .34 : .16));
    structure.current.position.set(-s * (mobile ? 1.35 : 3.1), -s * (mobile ? .9 : 1.3), -.25 - s * .6);
    structure.current.rotation.set(s * .1, -s * .12, s * .035);
    structure.current.scale.setScalar(1 - s * (mobile ? .47 : .31) - c * .65);
    structure.current.visible = c < .94;
    content.current.position.set(s * (mobile ? 1.35 : 3.35) + c * (mobile ? 1.7 : 2.65), -s * (mobile ? .9 : 1.5) - c * 1.14, -.14 + s * .4 + c * .95);
    content.current.rotation.set(s * -.07, c * -.12, s * -.03);
    content.current.scale.setScalar(1 - s * (mobile ? .47 : .31) - c * (mobile ? .4 : .28));
    if (!compact && !reduced && Math.abs(target - smooth.current) > .00001) invalidate();
  });
  return <>
    <ambientLight intensity={1.1} />
    <directionalLight position={[2, 8, 5]} intensity={3} color="#f3f7ed" />
    <Environment resolution={128} frames={1}>
      <Lightformer intensity={3} position={[0, 5, -2]} rotation={[Math.PI / 2, 0, 0]} scale={[14, 4, 1]} />
      <Lightformer intensity={2} position={[-7, 1, 3]} rotation={[0, Math.PI / 2, 0]} scale={[5, 12, 1]} color="#bfcec1" />
    </Environment>
    <group ref={assembly}>
      <group ref={structure}><WindowSurface texture={textures[1]} /></group>
      <group ref={content}><WindowSurface texture={textures[2]} /></group>
      <group ref={site}><WindowSurface texture={textures[0]} /></group>
    </group>
  </>;
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="scene-fallback"><img src={MEDIA} alt="Architectural website media" /></div> : this.props.children; }
}

export default function CinematicScene({ compact = false, progress: suppliedProgress }: { compact?: boolean; progress?: MutableRefObject<number> }) {
  const ownProgress = useRef(0);
  const progress = suppliedProgress || ownProgress;
  const element = useRef<HTMLDivElement>(null);
  const [onscreen, setOnscreen] = useState(true);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setOnscreen(entry.isIntersecting));
    if (element.current) observer.observe(element.current);
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReduced(preference.matches);
    const visibility = () => setVisible(!document.hidden);
    preference.addEventListener('change', changed);
    document.addEventListener('visibilitychange', visibility);
    return () => { observer.disconnect(); preference.removeEventListener('change', changed); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  return <div ref={element} className={'cinematic-canvas ' + (compact ? 'compact' : '')} aria-label="Three-dimensional source website, content structure, and admin workspace">
    <SceneBoundary><Suspense fallback={<div className="scene-loading" />}><Canvas camera={{ position: [0, 0, 11.4], fov: 42 }}
      dpr={[1, 1.5]} frameloop={!visible || !onscreen ? 'never' : !reduced && compact ? 'always' : 'demand'}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}>
      <Suspense fallback={null}><Sequence progress={progress} reduced={reduced} compact={compact} /></Suspense>
    </Canvas></Suspense></SceneBoundary>
  </div>;
}
