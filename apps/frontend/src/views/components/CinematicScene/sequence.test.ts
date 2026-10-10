import { describe, expect, it } from 'vitest';
import { scenePose } from './sequence';

describe('Cinematic sequence', () => {
  it('travels from a source website through exploded layers to a connected workspace', () => {
    const original = scenePose(0);
    const exploded = scenePose(.46);
    const connected = scenePose(1);
    expect(original.spread).toBe(0);
    expect(exploded.spread).toBe(1);
    expect(connected.spread).toBe(0);
    expect(connected.connected).toBe(1);
    expect(exploded.cameraZ).not.toBe(original.cameraZ);
    expect(exploded.rx).not.toBe(original.rx);
  });
  it('clamps endpoints and keeps every intermediate pose finite and continuous', () => {
    expect(scenePose(-1)).toEqual(scenePose(0));
    expect(scenePose(2)).toEqual(scenePose(1));
    let previous = scenePose(0);
    for (let i = 1; i <= 1000; i++) {
      const pose = scenePose(i / 1000);
      Object.entries(pose).forEach(([key, value]) => {
        expect(Number.isFinite(value)).toBe(true);
        expect(Math.abs(value - previous[key as keyof typeof pose])).toBeLessThan(.04);
      });
      previous = pose;
    }
  });
  it('centers mobile and compact compositions below their respective copy', () => {
    expect(scenePose(.5, true).x).toBe(0);
    expect(scenePose(.5, true).y).toBeLessThan(-1);
    expect(scenePose(.5, true).scale).toBeLessThan(scenePose(.5).scale);
    expect(scenePose(.5, false, true).x).toBe(.15);
  });
});
