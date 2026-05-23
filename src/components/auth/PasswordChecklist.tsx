import { CheckCircle2 } from 'lucide-react';
import { passwordRuleKeys, validatePasswordRules, type PasswordRuleKey } from '../../utils/passwordPolicy';

type Labels = Record<PasswordRuleKey | 'match', string>;
type ChecklistItem = {
  key: PasswordRuleKey | 'match';
  label: string;
  passed: boolean;
};

const defaultLabels: Labels = {
  length: 'At least 8 characters',
  lowercase: 'One lowercase letter',
  uppercase: 'One uppercase letter',
  number: 'One number',
  special: 'One special character',
  match: 'Passwords match',
};

export function PasswordChecklist({
  password,
  confirmPassword,
  labels = defaultLabels,
}: {
  password: string;
  confirmPassword?: string;
  labels?: Partial<Labels>;
}) {
  const mergedLabels = { ...defaultLabels, ...labels };
  const rules = validatePasswordRules(password);
  const items: ChecklistItem[] = passwordRuleKeys.map((key) => ({ key, label: mergedLabels[key], passed: rules[key] }));

  if (confirmPassword !== undefined) {
    items.push({
      key: 'match',
      label: mergedLabels.match,
      passed: password.length > 0 && password === confirmPassword,
    });
  }

  return (
    <ul className="mt-2 grid gap-1.5 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item.key} className={`flex items-center gap-1.5 ${item.passed ? 'text-emerald-700' : 'text-gray-500'}`}>
          {item.passed ? (
            <CheckCircle2 size={14} className="shrink-0" aria-hidden="true" />
          ) : (
            <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-gray-300 bg-white" aria-hidden="true" />
          )}
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
