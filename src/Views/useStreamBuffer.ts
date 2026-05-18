import { useCallback, useEffect, useRef } from 'react';
import type { ChatMessage } from './HermesChatView.tsx';
import { generateMessageId } from '../utils/uuid.ts';

/**
 * Play a subtle typing sound effect.
 * Uses Web Audio API for a soft mechanical keyboard-like click.
 */
function playTypingSound(): void {
  try {
    const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // Soft high-frequency click
    oscillator.frequency.value = 800 + Math.random() * 400;
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0.03, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.05);

    // Clean up
    setTimeout(() => {
      oscillator.disconnect();
      gainNode.disconnect();
      audioCtx.close().catch(() => {});
    }, 100);
  } catch {
    // Audio not available
  }
}

/**
 * Trigger haptic feedback if supported.
 */
function triggerHaptic(): void {
  if (navigator.vibrate) {
    navigator.vibrate(5);
  }
}

/**
 * Custom hook to buffer rapid Server-Sent Events or ACP stream chunks
 * and flush them into React state via requestAnimationFrame to avoid UI stutter.
 *
 * PERFORMANCE NOTES:
 * - Buffers content in refs (not state) to avoid re-renders on every chunk.
 * - Flushes via requestAnimationFrame for smooth 60fps updates.
 * - Sound/haptic feedback is throttled to ~20/sec to avoid overwhelming
 *   the user (and the audio subsystem) during fast streams.
 *
 * USAGE:
 *   const { appendContent, appendReasoning, flushNow } = useStreamBuffer(
 *     setMessages, showReasoning, enableTypingSound, enableHaptic
 *   );
 *   appendContent("new chunk"); // queued for next rAF flush
 *   flushNow(); // force immediate flush (e.g., on stream end)
 */
export function useStreamBuffer(
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  showReasoning: boolean,
  enableTypingSound = false,
  enableHaptic = false
) {
  const streamingMessageIdRef = useRef<string | null>(null);
  const reasoningMessageIdRef = useRef<string | null>(null);
  const pendingContentRef = useRef<string>('');
  const pendingReasoningRef = useRef<string>('');
  const flushAnimationFrameRef = useRef<number | null>(null);
  const lastSoundTimeRef = useRef<number>(0);

  const flushBuffer = useCallback(() => {
    const content = pendingContentRef.current;
    const reasoning = pendingReasoningRef.current;

    if (!content && !reasoning) {
      flushAnimationFrameRef.current = null;
      return;
    }

    setMessages((prev) => {
      let updated = prev;

      if (content) {
        const assistantIndex = updated.findIndex(
          (m) => m.role === 'assistant' && m.id === streamingMessageIdRef.current
        );
        if (assistantIndex >= 0) {
          const newArray = [...updated];
          newArray[assistantIndex] = {
            ...newArray[assistantIndex]!,
            content: newArray[assistantIndex]!.content + content
          };
          updated = newArray;
        }
      }

      if (reasoning && showReasoning) {
        const reasoningIndex = updated.findIndex(
          (m) => m.role === 'reasoning' && m.id === reasoningMessageIdRef.current
        );
        if (reasoningIndex >= 0) {
          const newArray = [...updated];
          newArray[reasoningIndex] = {
            ...newArray[reasoningIndex]!,
            content: newArray[reasoningIndex]!.content + reasoning
          };
          updated = newArray;
        } else {
          const newId = generateMessageId();
          reasoningMessageIdRef.current = newId;
          updated = [...updated, {
            id: newId,
            content: reasoning,
            role: 'reasoning',
            timestamp: Date.now()
          }];
        }
      }

      return updated;
    });

    pendingContentRef.current = '';
    pendingReasoningRef.current = '';
    flushAnimationFrameRef.current = null;
  }, [setMessages, showReasoning]);

  const scheduleFlush = useCallback(() => {
    if (flushAnimationFrameRef.current === null) {
      flushAnimationFrameRef.current = requestAnimationFrame(flushBuffer);
    }
  }, [flushBuffer]);

  const flushNow = useCallback(() => {
    if (flushAnimationFrameRef.current !== null) {
      cancelAnimationFrame(flushAnimationFrameRef.current);
    }
    flushBuffer();
  }, [flushBuffer]);

  const appendContent = useCallback((content: string) => {
    pendingContentRef.current += content;
    scheduleFlush();

    // Throttled sound/haptic feedback
    const now = Date.now();
    if (now - lastSoundTimeRef.current > 50) { // Max ~20 sounds per second
      lastSoundTimeRef.current = now;
      if (enableTypingSound) {
        playTypingSound();
      }
      if (enableHaptic) {
        triggerHaptic();
      }
    }
  }, [scheduleFlush, enableTypingSound, enableHaptic]);

  const appendReasoning = useCallback((reasoning: string) => {
    pendingReasoningRef.current += reasoning;
    scheduleFlush();
  }, [scheduleFlush]);

  useEffect(() => {
    return () => {
      if (flushAnimationFrameRef.current !== null) {
        cancelAnimationFrame(flushAnimationFrameRef.current);
      }
    };
  }, []);

  return {
    streamingMessageIdRef,
    reasoningMessageIdRef,
    appendContent,
    appendReasoning,
    flushNow
  };
}
