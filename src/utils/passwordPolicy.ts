export type PasswordRuleKey = 'length' | 'lowercase' | 'uppercase' | 'number' | 'special';

export const passwordRuleKeys: PasswordRuleKey[] = ['length', 'lowercase', 'uppercase', 'number', 'special'];

export const validatePasswordRules = (password: string): Record<PasswordRuleKey, boolean> => ({
  length: password.length >= 8,
  lowercase: /[a-z]/.test(password),
  uppercase: /[A-Z]/.test(password),
  number: /\d/.test(password),
  special: /[^A-Za-z0-9]/.test(password),
});

export const isStrongPassword = (password: string) =>
  Object.values(validatePasswordRules(password)).every(Boolean);
