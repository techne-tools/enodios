import { memo } from 'react';
import type { ReactElement } from 'react';
import type { AuditEntry } from '../../AuditLog.ts';

export interface AuditLogPanelProps {
  entries: AuditEntry[];
  onClear: () => void;
  onClose: () => void;
}

const STATUS_ICON: Record<AuditEntry['status'], string> = {
  blocked: '🚫',
  failure: '❌',
  pending: '⏳',
  success: '✅'
};

const ACTION_LABEL: Record<AuditEntry['action'], string> = {
  connection: '🔌 Connection',
  error: '💥 Error',
  file_change: '📝 File Change',
  permission: '🔐 Permission',
  terminal: '💻 Terminal',
  tool_call: '🔧 Tool Call'
};

/**
 * Render the useful fields of an audit entry — the human-readable summary
 * plus the structured metadata (paths, commands, exit codes, errors) that
 * actually help debug a problem.
 */
function EntryDetails({ entry }: { entry: AuditEntry }): ReactElement {
  const meta = entry.metadata ?? {};
  const rows: { label: string; value: string }[] = [];

  if (typeof meta['path'] === 'string') {
    rows.push({ label: 'Path', value: meta['path'] });
  }
  if (typeof meta['command'] === 'string') {
    rows.push({ label: 'Command', value: meta['command'] });
  }
  const exitCode = meta['exitCode'];
  if (typeof exitCode === 'number' || typeof exitCode === 'string') {
    rows.push({ label: 'Exit', value: String(exitCode) });
  }
  if (typeof meta['toolName'] === 'string') {
    rows.push({ label: 'Tool', value: meta['toolName'] });
  }
  if (typeof meta['permissionType'] === 'string') {
    rows.push({ label: 'Permission', value: meta['permissionType'] });
  }
  if (typeof meta['error'] === 'string' && meta['error']) {
    rows.push({ label: 'Error', value: meta['error'] });
  }

  return (
    <div className="enodios-audit-entry-details">
      <div className="enodios-audit-entry-summary">{entry.details}</div>
      {rows.length > 0 && (
        <dl className="enodios-audit-entry-meta">
          {rows.map((row) => (
            <div className="enodios-audit-entry-meta-row" key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
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
            <div className="enodios-audit-empty">No trace entries recorded yet. Enable Debug Mode in Settings → Troubleshooting to start recording.</div>
          )
          : (
            entries.map((entry, idx) => {
              const time = new Date(entry.timestamp).toLocaleTimeString();
              return (
                <div className={`enodios-audit-entry ${entry.status}`} key={idx}>
                  <div className="enodios-audit-entry-header">
                    <span>{STATUS_ICON[entry.status]} {ACTION_LABEL[entry.action]}</span>
                    <span className="enodios-audit-entry-time">{time}</span>
                  </div>
                  <EntryDetails entry={entry} />
                </div>
              );
            })
          )}
      </div>
    </div>
  );
});
