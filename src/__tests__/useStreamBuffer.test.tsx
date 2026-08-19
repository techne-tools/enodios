// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStreamBuffer } from '../Views/useStreamBuffer.ts';
import type { ChatMessage } from '../Views/EnodiosChatView.tsx';

describe('useStreamBuffer', () => {
  let rAFCallbacks: Array<FrameRequestCallback> = [];

  beforeEach(() => {
    rAFCallbacks = [];
    // Mock requestAnimationFrame to capture callbacks and prevent them from firing automatically
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rAFCallbacks.push(cb);
      return rAFCallbacks.length;
    });
    // Mock cancelAnimationFrame to neutralise the callback
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      if (id > 0 && id <= rAFCallbacks.length) {
        rAFCallbacks[id - 1] = () => {};
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Helper to manually trigger the animation frames
  const flushRAF = () => {
    const callbacks = [...rAFCallbacks];
    rAFCallbacks = [];
    callbacks.forEach((cb) => cb(performance.now()));
  };

  it('should buffer multiple appendContent calls and flush once', () => {
    let state: ChatMessage[] = [{ role: 'assistant', content: 'Hello', timestamp: 1, id: '1' }];
    const setMessages = vi.fn().mockImplementation((updater) => {
      state = updater(state);
    });

    const { result } = renderHook(() => useStreamBuffer(setMessages, false));
    result.current.streamingMessageIdRef.current = '1';

    act(() => {
      result.current.appendContent(' world');
      result.current.appendContent('!');
    });

    // setMessages shouldn't be called yet because rAF hasn't fired (buffering)
    expect(setMessages).not.toHaveBeenCalled();

    act(() => flushRAF());

    expect(setMessages).toHaveBeenCalledTimes(1);
    expect(state[0]?.content).toBe('Hello world!');
  });

  it('should synchronously flush when flushNow is called', () => {
    let state: ChatMessage[] = [{ role: 'assistant', content: 'Sync', timestamp: 2, id: '2' }];
    const setMessages = vi.fn().mockImplementation((updater) => {
      state = updater(state);
    });

    const { result } = renderHook(() => useStreamBuffer(setMessages, false));
    result.current.streamingMessageIdRef.current = '2';

    act(() => {
      result.current.appendContent(' flush');
      result.current.flushNow();
    });

    expect(setMessages).toHaveBeenCalledTimes(1);
    expect(state[0]?.content).toBe('Sync flush');
  });

  it('should append reasoning to a separate message when showReasoning is true', () => {
    let state: ChatMessage[] = [{ role: 'assistant', content: '', timestamp: 3, id: '3' }];
    const setMessages = vi.fn().mockImplementation((updater) => {
      state = updater(state);
    });

    const { result } = renderHook(() => useStreamBuffer(setMessages, true));
    result.current.streamingMessageIdRef.current = '3';

    act(() => {
      result.current.appendReasoning('Thinking...');
      result.current.flushNow();
    });

    // It should dynamically create a new reasoning message and insert it before the assistant response
    expect(state).toHaveLength(2);
    expect(state[0]?.role).toBe('reasoning');
    expect(state[0]?.content).toBe('Thinking...');
    expect(state[1]?.role).toBe('assistant');
  });

  it('should successfully flush pending content even when the message ID ref is set to null synchronously right after flushNow()', () => {
    let state: ChatMessage[] = [{ role: 'assistant', content: 'Base', timestamp: 4, id: '4' }];
    const setMessages = vi.fn().mockImplementation((updater) => {
      state = updater(state);
    });

    const { result } = renderHook(() => useStreamBuffer(setMessages, false));
    result.current.streamingMessageIdRef.current = '4';

    act(() => {
      result.current.appendContent(' appended');
      // Call flushNow, then synchronously clear the ref to null (simulating the 'stop' event handler behavior)
      result.current.flushNow();
      result.current.streamingMessageIdRef.current = null;
    });

    expect(setMessages).toHaveBeenCalledTimes(1);
    expect(state[0]?.content).toBe('Base appended');
  });
});
