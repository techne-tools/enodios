import { memo  } from 'react';
import type { ReactElement } from 'react';
import type { AuditEntry } from '../../AuditLog.ts';

export interface AuditLogPanelProps {
  entries: AuditEntry[];
  onClear: () => void;
  onClose: () => void;
}

export const AuditLogPanel = memo(({ entries, onClear, onClose }: AuditLogPanelProps): ReactElement => {
  return (
    <div className="hermes-audit-log-panel">
      <div className="hermes-audit-log-header">
        <span>Audit Trace Log</span>
        <div className="hermes-audit-log-actions">
          <button className="hermes-text-btn" onClick={onClear} type="button">Clear</button>
          <button className="hermes-icon-btn" onClick={onClose} title="Close" type="button">✕</button>
        </div>
      </div>
      <div className="hermes-audit-log-list">
        {entries.length === 0
? (
          <div className="hermes-audit-empty">No trace entries recorded yet</div>
        )
: (
          entries.map((entry, idx) => {
            const time = new Date(entry.timestamp).toLocaleTimeString();
            const icon = {
              blocked: '🚫',
              failure: '❌',
              pending: '⏳',
              success: '✅'
            }[entry.status];

            const actionLabel = {
              connection: '🔌',
              error: '💥',
              file_change: '📝',
              permission: '🔐',
              terminal: '💻',
              tool_call: '🔧'
            }[entry.action];

            return (
              <div className={`hermes-audit-entry ${entry.status}`} key={idx}>
                <div className="hermes-audit-entry-header">
                  <span>{icon} {actionLabel} <strong>{entry.action}</strong></span>
                  <span className="hermes-audit-entry-time">{time}</span>
                </div>
                <div className="hermes-audit-entry-details">
                  {entry.details}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});
