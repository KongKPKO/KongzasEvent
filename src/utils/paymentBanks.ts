export interface PaymentBankAccount {
  bank_name: string;
  account_name: string;
  account_number: string;
}

export const createEmptyBankAccount = (): PaymentBankAccount => ({ bank_name: '', account_name: '', account_number: '' });

export const normalizePaymentBankAccounts = (accounts: PaymentBankAccount[]): PaymentBankAccount[] => accounts
  .map(account => ({ bank_name: account.bank_name.trim(), account_name: account.account_name.trim(), account_number: account.account_number.trim() }))
  .filter(account => Boolean(account.bank_name || account.account_name || account.account_number));

export function getPaymentBankAccounts(method: {
  bank_accounts?: PaymentBankAccount[] | null;
  bank_name?: string | null;
  account_name?: string | null;
  account_number?: string | null;
}): PaymentBankAccount[] {
  if (method.bank_accounts?.length) return normalizePaymentBankAccounts(method.bank_accounts);
  return normalizePaymentBankAccounts([{
    bank_name: method.bank_name || '',
    account_name: method.account_name || '',
    account_number: method.account_number || '',
  }]);
}
