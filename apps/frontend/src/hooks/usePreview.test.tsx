import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreview } from './usePreview';
const { post, put, release } = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn(), release: vi.fn() }));
vi.mock('../services/api', () => ({ default: { post, put, defaults: { baseURL: 'http://localhost:5000/api' } } }));
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', release); release.mockResolvedValue({ ok: true }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('Preview lifecycle', () => {
  it('starts only on request and stops on unmount', async () => {
    post.mockResolvedValue({ data: { status: 'ready', url: 'http://localhost:5001/preview' } });
    const hook = renderHook(() => usePreview('job-1'));
    expect(post).not.toHaveBeenCalled();
    await act(async () => { await hook.result.current.start(); });
    expect(hook.result.current.status).toBe('ready');
    const started = post.mock.calls[0][0];
    hook.unmount();
    expect(release).toHaveBeenCalledWith('http://localhost:5000/api' + started, expect.objectContaining({ method: 'DELETE', keepalive: true }));
  });
  it('releases a pending start without accepting its late response', async () => {
    let resolve: (value: any) => void = () => {};
    post.mockImplementation(() => new Promise(done => { resolve = done; }));
    const hook = renderHook(() => usePreview('job-1'));
    act(() => { void hook.result.current.start(); });
    expect(hook.result.current.status).toBe('starting');
    await act(async () => { await hook.result.current.stop(); });
    await act(async () => { resolve({ data: { status: 'ready', url: 'late' } }); });
    expect(hook.result.current.status).toBe('stopped');
    expect(release).toHaveBeenCalledOnce();
  });
  it('stops the previous project before its hook is reused', async () => {
    post.mockResolvedValue({ data: { status: 'ready', url: 'first' } });
    const hook = renderHook(({ id }) => usePreview(id), { initialProps: { id: 'first' } });
    await act(async () => { await hook.result.current.start(); });
    hook.rerender({ id: 'second' });
    await waitFor(() => expect(hook.result.current.status).toBe('stopped'));
    expect(release).toHaveBeenCalledOnce();
  });
  it('does not reload the iframe on every renewed heartbeat', async () => {
    vi.useFakeTimers();
    post.mockResolvedValue({ data: { status: 'ready', url: 'original-capability' } });
    put.mockResolvedValue({ data: { status: 'ready', url: 'renewed-capability' } });
    const hook = renderHook(() => usePreview('job-1'));
    await act(async () => { await hook.result.current.start(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(hook.result.current.url).toBe('original-capability');
    hook.unmount();
  });
  it('keeps the same preview through a temporary heartbeat failure', async () => {
    vi.useFakeTimers();
    post.mockResolvedValue({ data: { status: 'ready', url: 'original' } });
    put.mockRejectedValueOnce({ response: { status: 503 } }).mockResolvedValue({ data: { status: 'ready', url: 'renewed' } });
    const hook = renderHook(() => usePreview('job-1'));
    await act(async () => { await hook.result.current.start(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(hook.result.current.status).toBe('ready');
    expect(hook.result.current.url).toBe('original');
    expect(release).not.toHaveBeenCalled();
    hook.unmount();
  });
  it('releases its lease after repeated transport failures', async () => {
    vi.useFakeTimers();
    post.mockResolvedValue({ data: { status: 'starting' } });
    put.mockRejectedValue({ response: { status: 503 } });
    const hook = renderHook(() => usePreview('job-1'));
    await act(async () => { await hook.result.current.start(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(hook.result.current.status).toBe('failed');
    expect(release).toHaveBeenCalledOnce();
    hook.unmount();
  });
});
