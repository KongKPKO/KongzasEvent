import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, ShieldCheck, AlertCircle } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { Button, Card } from '../components/ui';
import { LanguageToggle, useI18n } from '../i18n';

export default function ResetPassword() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);
    setMessage(null);

    if (password.length < 8) {
      setErrorMsg(t('resetPasswordShort'));
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg(t('resetPasswordMismatch'));
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      setMessage(t('resetSuccess'));
      window.setTimeout(async () => {
        await supabase.auth.signOut();
        navigate('/manage-login', { replace: true });
      }, 900);
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : t('resetFailed');
      setErrorMsg(nextMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-5 flex justify-end">
          <LanguageToggle />
        </div>
        <div className="text-center mb-8">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-pink-50 text-pink-600">
            <ShieldCheck size={26} aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-black text-gray-900">{t('resetTitle')}</h1>
          <p className="mt-2 text-sm font-medium text-gray-500">{t('resetBody')}</p>
        </div>

        <Card className="p-8 shadow-xl border-gray-100 bg-white">
          {errorMsg && (
            <div className="mb-5 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-600">
              <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          )}

          {message && (
            <div className="mb-5 rounded-lg border border-green-100 bg-green-50 p-3 text-sm font-medium text-green-700" aria-live="polite">
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="email"
              name="username"
              autoComplete="username"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
            />

            <div>
              <label htmlFor="new-password" className="block text-sm font-bold text-gray-700 mb-1">
                {t('resetNewPassword')}
              </label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} aria-hidden="true" />
                <input
                  id="new-password"
                  name="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 py-2 pl-10 pr-4 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-pink-500"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="confirm-password" className="block text-sm font-bold text-gray-700 mb-1">
                {t('resetConfirmPassword')}
              </label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} aria-hidden="true" />
                <input
                  id="confirm-password"
                  name="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 py-2 pl-10 pr-4 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-pink-500"
                  required
                />
              </div>
            </div>

            <Button type="submit" disabled={loading} className="w-full bg-pink-600 hover:bg-pink-700 text-white font-bold py-3">
              {loading ? t('resetUpdating') : t('resetSubmit')}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
