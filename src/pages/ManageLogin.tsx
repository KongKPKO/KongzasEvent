import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { Card, Button } from '../components/ui';
import { KeyRound, Mail, AlertCircle } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchActorContext } from '../utils/access';
import { canAccessManagementPages, canAccessQueuePages } from '../types/access';
import { LanguageToggle, useI18n } from '../i18n';

const ManageLogin = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Check if already logged in
  useEffect(() => {
     let isMounted = true;

     const hydrate = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!isMounted || !data.session) return;

        const ctx = await fetchActorContext();
        if (!isMounted) return;

        const { data: isAdmin } = await supabase.rpc('is_platform_admin');

        if (redirectTo === '/admin/applications' && isAdmin) {
          navigate('/admin/applications');
        } else if (canAccessManagementPages(ctx?.role)) {
          navigate('/manage-events');
        } else if (canAccessQueuePages(ctx?.role)) {
          navigate('/manage-pos-queues');
        } else if (isAdmin) {
          navigate('/admin/applications');
        }
      } catch (error) {
        console.error('[ManageLogin] getSession failed:', error);
      }
     };

     void hydrate();

     return () => {
      isMounted = false;
     };
  }, [navigate, redirectTo]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      const ctx = await fetchActorContext();
      const { data: isAdmin } = await supabase.rpc('is_platform_admin');

      if (redirectTo === '/admin/applications' && isAdmin) {
        navigate('/admin/applications');
      } else if (canAccessManagementPages(ctx?.role)) {
        navigate('/manage-events');
      } else if (canAccessQueuePages(ctx?.role)) {
        navigate('/manage-pos-queues');
      } else if (isAdmin) {
        navigate('/admin/applications');
      } else {
        setErrorMsg(t('loginNoWorkspace'));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      setErrorMsg(message);
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
          <h1 className="text-3xl font-black tracking-normal text-gray-950 mb-2">Nire<span className="text-pink-600">q</span></h1>
          <p className="text-gray-500 font-medium">{t('loginPortal')}</p>
        </div>

        <Card className="p-8 shadow-xl border-gray-100 bg-white">
          <h2 className="text-xl font-bold mb-6 text-gray-800 flex items-center gap-2">
            <KeyRound className="text-pink-600" />
            {t('loginTitle')}
          </h2>

          {errorMsg && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-6 flex items-start gap-2 text-sm font-medium border border-red-100 animate-fade-in">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleLogin} aria-label={t('loginTitle')} data-testid="creator-login-form" className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-bold text-gray-700 mb-1">{t('loginEmail')}</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="email"
                  id="login-email"
                  name="email"
                  autoComplete="email"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-all"
                  placeholder={t('loginEmailPlaceholder')}
                  required
                />
              </div>
            </div>
            
            <div>
              <label htmlFor="login-password" className="block text-sm font-bold text-gray-700 mb-1">{t('loginPassword')}</label>
              <div className="relative">
                 <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="password"
                  id="login-password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-all"
                  placeholder={t('loginPasswordPlaceholder')}
                  required
                />
              </div>
            </div>

            <Button 
              type="submit" 
              data-testid="creator-login-submit"
              className="w-full bg-pink-600 hover:bg-pink-700 text-white font-bold py-3 mt-4"
              disabled={loading}
            >
              {loading ? t('loginSubmitting') : t('loginSubmit')}
            </Button>
          </form>
        </Card>

        <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4 text-center text-sm text-gray-600 shadow-sm">
          {t('loginNeedWorkspace')}{' '}
          <Link to="/creator/register" className="font-black text-pink-700 hover:text-pink-800">
            {t('loginApplyAccess')}
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ManageLogin;
