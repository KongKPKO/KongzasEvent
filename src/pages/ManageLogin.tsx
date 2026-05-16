import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Card, Button } from '../components/ui';
import { KeyRound, Mail, AlertCircle, Send } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchActorContext } from '../utils/access';
import { canAccessManagementPages, canAccessQueuePages } from '../types/access';
import type { ActorRole } from '../types/access';
import { LanguageToggle, useI18n } from '../i18n';

interface AccessibleEvent {
  id: string;
}

const ManageLogin = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [magicMsg, setMagicMsg] = useState<string | null>(null);

  const getStaffRedirectUrl = () => `${window.location.origin}/manage-login?staff=1`;

  const routeInFlightRef = useRef(false);

  const getLivePathForRole = useCallback(async (role?: ActorRole | null) => {
    if (role !== 'seller' && role !== 'queue_staff') return '/manage-pos-queues';

    const { data } = await supabase.rpc('list_accessible_pos_events');
    const firstEvent = ((data || []) as AccessibleEvent[])[0];
    const query = firstEvent?.id ? `?eventId=${firstEvent.id}` : '';

    return role === 'seller'
      ? `/live/pos${query}`
      : `/live/queue${query}`;
  }, []);

  const routeAfterAuth = useCallback(async () => {
    if (routeInFlightRef.current) return;
    routeInFlightRef.current = true;

    try {
      const ctx = await fetchActorContext();
      const [{ data: isAdmin }, { data: invites }] = await Promise.all([
        supabase.rpc('is_platform_admin'),
        supabase.rpc('list_my_pending_invitations'),
      ]);

      if (redirectTo === '/admin/applications' && isAdmin) {
        navigate('/admin/applications');
      } else if (canAccessManagementPages(ctx?.role)) {
        navigate('/manage-events');
      } else if (canAccessQueuePages(ctx?.role)) {
        navigate(await getLivePathForRole(ctx?.role));
      } else if ((invites || []).length > 0) {
        navigate('/invitations');
      } else if (isAdmin) {
        navigate('/admin/applications');
      } else {
        setErrorMsg(t('loginNoWorkspace'));
      }
    } finally {
      routeInFlightRef.current = false;
    }
  }, [getLivePathForRole, navigate, redirectTo, t]);

  useEffect(() => {
    let isMounted = true;

    const routeAfterAuthLockReleases = () => {
      window.setTimeout(() => {
        if (isMounted) void routeAfterAuth();
      }, 0);
    };

    const initialTimer = window.setTimeout(async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (data.session) routeAfterAuthLockReleases();
      } catch (error) {
        console.error('[ManageLogin] getSession failed:', error);
      }
    }, 0);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!nextSession) return;
      if (event === 'PASSWORD_RECOVERY') return;
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        routeAfterAuthLockReleases();
      }
    });

    return () => {
      isMounted = false;
      window.clearTimeout(initialTimer);
      subscription.unsubscribe();
    };
  }, [routeAfterAuth]);

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

      await routeAfterAuth();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };

  const handleStaffMagicLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMagicLoading(true);
    setErrorMsg(null);
    setMagicMsg(null);

    try {
      const normalizedEmail = staffEmail.trim().toLowerCase();
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: getStaffRedirectUrl(),
          shouldCreateUser: false,
        },
      });

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      setMagicMsg('Magic link sent. Open the email to return to your assigned event workspace.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not send magic link.';
      setErrorMsg(message);
    } finally {
      setMagicLoading(false);
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

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-100" />
            <span className="text-[11px] font-black uppercase tracking-wide text-gray-400">Staff magic link</span>
            <div className="h-px flex-1 bg-gray-100" />
          </div>

          <form onSubmit={handleStaffMagicLogin} aria-label="Staff magic link login" className="space-y-3">
            <p className="text-xs leading-5 text-gray-500">
              Seller and queue staff can sign back in without a password. Use the same email that accepted the invitation.
            </p>
            <div>
              <label htmlFor="staff-login-email" className="block text-sm font-bold text-gray-700 mb-1">Staff email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="email"
                  id="staff-login-email"
                  name="staff-email"
                  autoComplete="email"
                  spellCheck={false}
                  value={staffEmail}
                  onChange={(e) => setStaffEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-all"
                  placeholder="staff@example.com"
                  required
                />
              </div>
            </div>
            {magicMsg && (
              <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                {magicMsg}
              </p>
            )}
            <Button
              type="submit"
              className="w-full border border-pink-700 bg-pink-700 py-3 font-bold text-white hover:bg-pink-800"
              disabled={magicLoading || staffEmail.trim().length < 4}
            >
              <Send size={16} />
              {magicLoading ? 'Sending magic link…' : 'Send staff magic link'}
            </Button>
          </form>
        </Card>

        <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4 text-center text-sm text-gray-600 shadow-sm">
          {t('loginNeedWorkspace')}{' '}
          <Link to="/creator/register" className="font-black text-pink-700 hover:text-pink-800">
            {t('loginApplyAccess')}
          </Link>
          <div className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500">
            Invited as staff?{' '}
            <Link to="/staff-signup" className="font-black text-pink-700 hover:text-pink-800">
              Create a staff account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManageLogin;
