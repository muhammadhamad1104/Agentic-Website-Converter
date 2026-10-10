import { MathUtils } from 'three';

export type ScenePose = {
  x: number; y: number; scale: number; rx: number; ry: number; rz: number;
  spread: number; connected: number; cameraY: number; cameraZ: number;
};

const keyframes: Array<[number, ScenePose]> = [
  [0, { x: 2.15, y: -.45, scale: 1.05, rx: .06, ry: -.34, rz: -.07, spread: 0, connected: 0, cameraY: .3, cameraZ: 11.4 }],
  [.23, { x: 1.85, y: -.25, scale: 1.12, rx: -.08, ry: -.18, rz: -.04, spread: .06, connected: 0, cameraY: .1, cameraZ: 11 }],
  [.46, { x: 1.45, y: -.5, scale: .91, rx: .08, ry: -.2, rz: -.025, spread: 1, connected: 0, cameraY: .1, cameraZ: 11 }],
  [.61, { x: 1.45, y: -.5, scale: .9, rx: .03, ry: .04, rz: .025, spread: 1, connected: .1, cameraY: .15, cameraZ: 11 }],
  [.84, { x: 1.8, y: -.35, scale: .85, rx: .02, ry: -.14, rz: -.04, spread: 0, connected: 1, cameraY: .1, cameraZ: 11.4 }],
  [1, { x: 1.65, y: -.35, scale: .91, rx: .06, ry: -.2, rz: -.04, spread: 0, connected: 1, cameraY: .1, cameraZ: 11.4 }],
];

export function scenePose(progress: number, mobile = false, compact = false): ScenePose {
  const p = MathUtils.clamp(progress, 0, 1);
  const right = keyframes.findIndex(([time]) => time >= p);
  const [start, from] = keyframes[Math.max(0, right - 1)];
  const [end, to] = keyframes[Math.max(0, right)];
  const t = end === start ? 0 : MathUtils.smoothstep(p, start, end);
  const pose = Object.fromEntries(Object.keys(from).map(key => [key, MathUtils.lerp(from[key as keyof ScenePose], to[key as keyof ScenePose], t)])) as ScenePose;
  if (mobile || compact) {
    pose.x = compact ? .15 : 0;
    pose.y = compact ? -.1 : -1.75;
    pose.scale *= compact ? .88 : .69;
    pose.cameraZ = compact ? 10 : 12.5;
    pose.cameraY = 0;
  }
  return pose;
}
