import {
 useCallback,
useEffect,
useRef
} from 'react';

import type { ChatMessage } from './EnodiosChatView.tsx';

import { generateMessageId } from '../utils/uuid.ts';

/**
 * Custom hook to buffer rapid Server-Sent Events or ACP stream chunks
 * and flush them into React state via requestAnimationFrame to avoid UI stutter.
 *
 * ARCHITECTURAL ROLE:
 * Streaming LLM responses can emit 10–50 chunks per second. Updating React
 * state that frequently causes re-renders and dropped frames. This hook
 * decouples the high-frequency stream from the lower-frequency UI by:
 *   1. Accumulating chunks in refs (no re-renders)
 *   2. Flushing to state inside a requestAnimationFrame callback (60fps cap)
 *   3. Throttling sound/haptic feedback to ~20/sec
 *
 * DESIGN DECISIONS:
 * - Uses refs for pending content, not state, to avoid React re-render churn.
 * - The `setMessages` updater function captures the latest ref values
 *   atomically, preventing race conditions where a chunk arrives between
 *   read and write.
 * - Two separate message IDs are tracked: one for the assistant response
 *   and one for reasoning steps, so they can be updated independently.
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
  const streamingMessageIdRef = useRef<null | string>(null);
  const reasoningMessageIdRef = useRef<null | string>(null);
  const pendingContentRef = useRef<string>('');
  const pendingReasoningRef = useRef<string>('');
  const flushAnimationFrameRef = useRef<null | number>(null);
  const lastSoundTimeRef = useRef<number>(0);

  const flushBuffer = useCallback(() => {
    const content = pendingContentRef.current;
    const reasoning = pendingReasoningRef.current;

    if (!content && !reasoning) {
      flushAnimationFrameRef.current = null;
      return;
    }

    // Capture current ref values synchronously before scheduling the asynchronous state update.
    // This prevents race conditions where the refs are cleared (set to null) synchronously
    // in the same tick/event loop turn as flushNow/flushBuffer but before the React state updater runs.
    const currentStreamingId = streamingMessageIdRef.current;
    const currentReasoningId = reasoningMessageIdRef.current;

    // Capture and clear pending content atomically inside the setMessages updater
    // To prevent race conditions where a chunk arrives between capture and clear.
    setMessages((prev) => {
      // Read the latest pending content (may have grown since the outer capture)
      const latestContent = pendingContentRef.current;
      const latestReasoning = pendingReasoningRef.current;

      // Clear the refs atomically with the state update
      pendingContentRef.current = '';
      pendingReasoningRef.current = '';
      flushAnimationFrameRef.current = null;

      let updated = prev;

      if (latestContent && currentStreamingId) {
        const assistantIndex = updated.findIndex(
          (m) => m.role === 'assistant' && m.id === currentStreamingId
        );
        if (assistantIndex >= 0) {
          const newArray = [...updated];
          newArray[assistantIndex] = {
            ...newArray[assistantIndex]!,
            content: newArray[assistantIndex]!.content + latestContent
          };
          updated = newArray;
        }
      }

      if (latestReasoning && showReasoning) {
        const reasoningIndex = currentReasoningId
          ? updated.findIndex(
              (m) => m.role === 'reasoning' && m.id === currentReasoningId
            )
          : -1;
        if (reasoningIndex >= 0) {
          const newArray = [...updated];
          newArray[reasoningIndex] = {
            ...newArray[reasoningIndex]!,
            content: newArray[reasoningIndex]!.content + latestReasoning
          };
          updated = newArray;
        } else {
          const newId = generateMessageId();
          reasoningMessageIdRef.current = newId;
          const reasoningMsg: ChatMessage = {
            content: latestReasoning,
            id: newId,
            isCollapsed: true, // Reasoning starts collapsed by default
            role: 'reasoning',
            timestamp: Date.now()
          };
          // Insert reasoning BEFORE the assistant placeholder so it appears above the response
          const assistantIndex = currentStreamingId
            ? updated.findIndex(
                (m) => m.role === 'assistant' && m.id === currentStreamingId
              )
            : -1;
          if (assistantIndex >= 0) {
            updated = [
              ...updated.slice(0, assistantIndex),
              reasoningMsg,
              ...updated.slice(assistantIndex)
            ];
          } else {
            updated = [...updated, reasoningMsg];
          }
        }
      }

      return updated;
    });
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
    appendContent,
    appendReasoning,
    flushNow,
    reasoningMessageIdRef,
    streamingMessageIdRef
  };
}

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
