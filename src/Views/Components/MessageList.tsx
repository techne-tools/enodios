import { memo  } from 'react';
import type { ReactElement } from 'react';
import type { EnodiosChatView, ChatMessage } from '../EnodiosChatView.tsx';
import { ChatMessageItem } from './ChatMessageItem.tsx';
import type { AcpConnectionStatus } from '../../ChatClient.ts';

// Helper component
function TypingIndicator({ agentName }: { agentName: string }): ReactElement {
    return <div className="enodios-typing-indicator">{agentName} is thinking...</div>;
}

export interface MessageListProps {
  messages: ChatMessage[];
  showReasoningSession: boolean;
  isTyping: boolean;
  editingMessageId: string | null;
  setEditingMessageId: (id: string | null) => void;
  handleEditSubmit: (id: string, text: string) => Promise<void>;
  view: EnodiosChatView;
  messageRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  agentName: string;
  connectionStatus: AcpConnectionStatus | null;
  error: string | null;
}

export const MessageList = memo(({
    messages,
    showReasoningSession,
    isTyping,
    editingMessageId,
    setEditingMessageId,
    handleEditSubmit,
    view,
    messageRefs,
    agentName,
    connectionStatus,
    error
}: MessageListProps): ReactElement => {
  return (
    <>
      {messages.map((msg) => {
        if (msg.role === 'reasoning' && !showReasoningSession) {
          return null;
        }
        // Skip rendering the empty assistant placeholder while the typing indicator is shown
        if (isTyping && msg.role === 'assistant' && !msg.content) {
          return null;
        }
        return (
          <div
            key={msg.id}
            ref={(el) => {
              if (el) { messageRefs.current.set(msg.id, el); }
            }}
          >
            <ChatMessageItem
              isEditing={editingMessageId === msg.id}
              message={msg}
              onCancelEdit={() => setEditingMessageId(null)}
              onEdit={(id, text) => {
                setEditingMessageId(null);
                void handleEditSubmit(id, text);
              }}
              onStartEdit={() => setEditingMessageId(msg.id)}
              view={view}
            />
          </div>
        );
      })}
      {isTyping && <TypingIndicator agentName={agentName} />}
      {connectionStatus && connectionStatus.state !== 'connected' && !(connectionStatus.state === 'error' && error) && (
        <div className={`enodios-status enodios-status-${connectionStatus.state}`} role="status">
          <span className="enodios-status-icon">
            {connectionStatus.state === 'error' ? '⚠️' : '⏳'}
          </span>
          <span className="enodios-status-text">
            {connectionStatus.state === 'connecting' && 'Connecting to Hermes via ACP...'}
            {connectionStatus.state === 'loading' && (connectionStatus.detail || 'Hermes is starting...')}
            {connectionStatus.state === 'error' && (connectionStatus.detail || 'Connection error')}
          </span>
        </div>
      )}
    </>
  );
});
