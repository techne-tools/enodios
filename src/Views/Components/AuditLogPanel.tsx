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
    <div className="enodios-audit-log-panel">
      <div className="enodios-audit-log-header">
        <span>Audit Trace Log</span>
        <div className="enodios-audit-log-actions">
          <button className="enodios-text-btn" onClick={onClear} type="button">Clear</button>
          <button className="enodios-icon-btn" onClick={onClose} title="Close" type="button">✕</button>
        </div>
      </div>
      <div className="enodios-audit-log-list">
        {entries.length === 0
? (
          <div className="enodios-audit-empty">No trace entries recorded yet</div>
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
              <div className={`enodios-audit-entry ${entry.status}`} key={idx}>
                <div className="enodios-audit-entry-header">
                  <span>{icon} {actionLabel} <strong>{entry.action}</strong></span>
                  <span className="enodios-audit-entry-time">{time}</span>
                </div>
                <div className="enodios-audit-entry-details">
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
