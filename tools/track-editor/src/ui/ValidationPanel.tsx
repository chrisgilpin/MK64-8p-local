import type { ValidationIssue } from '../model/types';

type Props = { issues: ValidationIssue[] };

export function ValidationPanel({ issues }: Props) {
  if (issues.length === 0) {
    return (
      <div className="validation ok">
        No issues — ready to export.
      </div>
    );
  }
  return (
    <div className="validation">
      <ul>
        {issues.map((issue, i) => (
          <li key={i} className={issue.level}>
            <strong>{issue.level}</strong>
            {issue.target && issue.target !== 'both' ? (
              <span className="tag">{issue.target}</span>
            ) : null}{' '}
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
