import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Card, Button } from '../components/ui';
import { KeyRound, Mail, AlertCircle, Send } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { completePendingVerifiedCreatorSignup, fetchActorContext } from '../utils/access';
import { canAccessManagementPages, canAccessQueuePages } from '../types/access';
import type { ActorRole } from '../types/access';
import PublicShell from '../components/PublicShell';
import { useI18n } from '../i18n';
import { getAuthRedirectError } from '../utils/authRedirect';

interface AccessibleEvent {
  id: string;
}

type LoginMode = 'creator' | 'staff';

const ManageLogin = () => {
  const { t, language } = useI18n();
  const th = language === 'th';
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [loginMode, setLoginMode] = useState<LoginMode>('creator');
  const [loading, setLoading] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(() => {
    const authError = getAuthRedirectError();
    if (!authError) return null;
    if (/expired|invalid/i.test(authError)) return 'This email link is expired or invalid. Return to registration to resend confirmation, or reset your password if the account is already confirmed.';
    return authError;
  });
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showCreatorApply, setShowCreatorApply] = useState(false);
  const [magicMsg, setMagicMsg] = useState<string | null>(null);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetErrorMsg, setResetErrorMsg] = useState<string | null>(null);
  const resetOpenerRef = useRef<HTMLButtonElement>(null);
  const resetDialogRef = useRef<HTMLDivElement>(null);
  const resetEmailRef = useRef<HTMLInputElement>(null);

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

  const routeAfterAuth = useCallback(async (options?: { allowAdminFallback?: boolean }) => {
    if (routeInFlightRef.current) return;
    routeInFlightRef.current = true;

    try {
      const signupCompletionStatus = await completePendingVerifiedCreatorSignup();
      const ctx = await fetchActorContext();
      const [{ data: isAdmin }, { data: invites }] = await Promise.all([
        supabase.rpc('is_platform_admin'),
        supabase.rpc('list_my_pending_invitations'),
      ]);

      if (['/admin/applications', '/admin/support'].includes(redirectTo || '') && isAdmin) {
        navigate(redirectTo!);
      } else if (canAccessManagementPages(ctx?.role)) {
        navigate('/manage-events');
      } else if (canAccessQueuePages(ctx?.role)) {
        navigate(await getLivePathForRole(ctx?.role));
      } else if ((invites || []).length > 0) {
        navigate('/invitations');
      } else if (isAdmin && options?.allowAdminFallback) {
        navigate('/admin/applications');
      } else if (signupCompletionStatus === 'email_unconfirmed') {
        setErrorMsg(t('loginConfirmEmailFirst'));
      } else if (!isAdmin) {
        setShowCreatorApply(true);
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
        if (isMounted) void routeAfterAuth({ allowAdminFallback: true });
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
    setShowCreatorApply(false);
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

      await routeAfterAuth({ allowAdminFallback: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setShowCreatorApply(false);
    setErrorMsg(null);

    const next = redirectTo?.startsWith('/') && !redirectTo.startsWith('//')
      ? `?redirect=${encodeURIComponent(redirectTo)}`
      : '';
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/manage-login${next}`,
      },
    });

    if (error) {
      setErrorMsg(t('googleLoginFailed'));
      setGoogleLoading(false);
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

      setMagicMsg(th ? 'ส่งลิงก์แล้ว เปิดอีเมลเพื่อเข้าสู่งานที่คุณได้รับมอบหมาย' : 'Magic link sent. Open the email to return to your assigned event workspace.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not send magic link.';
      setErrorMsg(message);
    } finally {
      setMagicLoading(false);
    }
  };

  const switchLoginMode = (nextMode: LoginMode) => {
    setLoginMode(nextMode);
    setShowCreatorApply(false);
    setErrorMsg(null);
    setMagicMsg(null);
    setResetMsg(null);

    if (nextMode === 'staff') {
      setIsResetModalOpen(false);
      setResetEmail('');
      setResetErrorMsg(null);
    }
  };

  const openResetModal = () => {
    setIsResetModalOpen(true);
    setResetEmail('');
    setResetErrorMsg(null);
    setResetMsg(null);
  };

  const closeResetModal = useCallback(() => {
    setIsResetModalOpen(false);
    setResetEmail('');
    setResetErrorMsg(null);
    setResetMsg(null);
  }, []);

  useEffect(() => {
    if (!isResetModalOpen) return;

    resetEmailRef.current?.focus();
    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !resetLoading) {
        event.preventDefault();
        closeResetModal();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(resetDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ) || []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      document.removeEventListener('keydown', handleDialogKeyDown);
      resetOpenerRef.current?.focus();
    };
  }, [closeResetModal, isResetModalOpen, resetLoading]);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = resetEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      setResetErrorMsg(t('passwordResetEmailRequired'));
      return;
    }

    setResetLoading(true);
    setResetErrorMsg(null);
    setResetMsg(null);

    try {
      await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setResetMsg(t('passwordResetSentNeutral'));
    } catch (error) {
      console.error('[ManageLogin] resetPasswordForEmail failed:', error);
      setResetMsg(t('passwordResetSentNeutral'));
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <PublicShell auth>
      <main className="public-auth-layout public-width">
        <aside className="public-auth-intro"><p className="public-kicker">{th ? 'สำหรับครีเอเตอร์และทีมงาน' : 'FOR CREATORS & TEAMS'}</p><h1>{th ? 'กลับมาดูแลร้าน' : 'Back to your shop.'}<span>{th ? 'ที่คุณรัก' : 'Ready for your next event.'}</span></h1><p>{th ? 'สินค้า ออเดอร์ และคิวของคุณ พร้อมให้จัดการต่อในที่เดียว' : 'Your products, orders and queues. Pick up where you left off.'}</p><div className="public-auth-note"><strong>{th ? 'มาเลือกซื้อหรือเข้าคิว?' : 'Here to shop or join a queue?'}</strong><p>{th ? 'ค้นหาร้านครีเอเตอร์ได้เลย ไม่ต้องสมัครบัญชีครีเอเตอร์' : 'Explore creator shops directly. You do not need a creator account.'}</p><Link to="/discover" className="public-text-link">{th ? 'ค้นหาครีเอเตอร์ →' : 'Discover creators →'}</Link></div></aside>
        <div className="public-auth-form">
        <Card className="public-auth-panel">
          <div role="tablist" aria-label="Login mode" className="public-auth-tabs">
            <button
              type="button"
              role="tab"
              aria-selected={loginMode === 'creator'}
              onClick={() => switchLoginMode('creator')}
              className={`public-auth-tab ${
                loginMode === 'creator'
                  ? 'bg-white text-pink-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {th ? 'ครีเอเตอร์ / ผู้จัดการ' : 'Creator / Manager'}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={loginMode === 'staff'}
              onClick={() => switchLoginMode('staff')}
              className={`public-auth-tab ${
                loginMode === 'staff'
                  ? 'bg-white text-pink-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {th ? 'ทีมงาน' : 'Staff'}
            </button>
          </div>

          <h2 className="text-xl font-bold mb-6 text-gray-800 flex items-center gap-2">
            <KeyRound className="text-pink-600" />
            {loginMode === 'creator' ? t('creatorManagerLoginTitle') : t('staffLoginTitle')}
          </h2>

          {errorMsg && (
            <div role="alert" className="bg-red-50 text-red-600 p-3 rounded-lg mb-6 flex items-start gap-2 text-sm font-medium border border-red-100 animate-fade-in">
              <AlertCircle aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
              {errorMsg}
            </div>
          )}

          {showCreatorApply && (
            <Link
              to="/creator/register"
              className="mb-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-gray-900 px-4 py-3 text-sm font-black text-white"
            >
              {t('loginApplyAsCreator')}
            </Link>
          )}

          {loginMode === 'creator' ? (
            <>
              <div className="mb-5 space-y-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleGoogleLogin()}
                  disabled={googleLoading}
                  className="min-h-12 w-full border-gray-300 bg-white px-4 py-3 font-black text-gray-900 shadow-none hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:opacity-60"
                >
                  <img
                    src="/google-g-logo.svg"
                    alt=""
                    aria-hidden="true"
                    data-testid="google-auth-logo"
                    className="h-5 w-5 shrink-0"
                  />
                  {googleLoading ? t('loginSubmitting') : t('continueWithGoogle')}
                </Button>
                <p className="text-xs leading-5 text-gray-500">{t('googleSameEmailHint')}</p>
                <div className="flex items-center gap-3 text-xs font-bold text-gray-600">
                  <span className="h-px flex-1 bg-gray-200" />
                  {t('orUseEmail')}
                  <span className="h-px flex-1 bg-gray-200" />
                </div>
              </div>
              <form onSubmit={handleLogin} aria-label={t('creatorManagerLoginTitle')} data-testid="creator-login-form" className="space-y-4">
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
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-colors"
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
                    type={showPassword ? 'text' : 'password'}
                    id="login-password"
                    name="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-colors"
                    placeholder={t('loginPasswordPlaceholder')}
                    required
                  />
                </div>
                <div className="public-password-tools"><label><input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} />{th ? 'แสดงรหัสผ่าน' : 'Show password'}</label>
                  <button
                    type="button"
                    ref={resetOpenerRef}
                    onClick={openResetModal}
                    disabled={resetLoading}
                    className="text-sm font-bold text-pink-700 hover:text-pink-800 disabled:text-pink-300"
                  >
                    {t('forgotPassword')}
                  </button>
                </div>
              </div>

              <Button 
                type="submit" 
                data-testid="creator-login-submit"
                className="public-button public-primary w-full mt-4"
                disabled={loading}
              >
                {loading ? t('loginSubmitting') : t('loginSubmit')}
              </Button>
              </form>
            </>
          ) : (
            <form onSubmit={handleStaffMagicLogin} aria-label="Staff magic link login" className="space-y-3">
              <p className="text-xs leading-5 text-gray-500">
                {th ? 'พนักงานขายและผู้ดูแลคิว ใช้อีเมลที่รับคำเชิญ ระบบจะส่งลิงก์เข้าสู่ระบบให้โดยไม่ต้องใช้รหัสผ่าน' : 'Seller and queue staff can sign back in without a password. Use the same email that accepted the invitation.'}
              </p>
              <div>
                <label htmlFor="staff-login-email" className="block text-sm font-bold text-gray-700 mb-1">{th ? 'อีเมลทีมงาน' : 'Staff email'}</label>
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
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-colors"
                    placeholder="staff@example.com"
                    required
                  />
                </div>
              </div>
              {magicMsg && (
                <p role="status" className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                  {magicMsg}
                </p>
              )}
              <Button
                type="submit"
                className="public-button public-primary w-full"
                disabled={magicLoading || staffEmail.trim().length < 4}
              >
                <Send size={16} />
                {magicLoading ? (th ? 'กำลังส่งลิงก์…' : 'Sending magic link…') : (th ? 'ส่งลิงก์เข้าสู่ระบบ' : 'Send staff magic link')}
              </Button>
            </form>
          )}
        </Card>

        <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4 text-center text-sm text-gray-600 shadow-sm">
          {t('loginNeedWorkspace')}{' '}
          <Link to="/creator/register" className="font-black text-pink-700 hover:text-pink-800">
            {t('loginApplyAccess')}
          </Link>
        </div>
        </div>
      </main>

      {isResetModalOpen && (
        <div ref={resetDialogRef} className="fixed inset-0 z-[130] flex items-center justify-center bg-gray-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="reset-password-title">
          <form onSubmit={handleForgotPassword} className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h2 id="reset-password-title" className="text-lg font-black text-gray-900">{th ? 'ตั้งรหัสผ่านใหม่' : 'Reset password'}</h2>
            <p className="mt-2 text-sm font-medium text-gray-600">
              {th ? 'ระบุอีเมลครีเอเตอร์หรือผู้จัดการ เพื่อรับลิงก์ตั้งรหัสผ่านใหม่' : "Enter your creator or manager email and we'll send a reset link."}
            </p>
            <div className="mt-4">
              <label htmlFor="reset-email" className="block text-sm font-bold text-gray-700 mb-1">{th ? 'อีเมลสำหรับตั้งรหัสผ่านใหม่' : 'Reset email'}</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  ref={resetEmailRef}
                  type="email"
                  id="reset-email"
                  name="reset-email"
                  autoComplete="email"
                  spellCheck={false}
                  value={resetEmail}
                  onChange={(e) => {
                    setResetEmail(e.target.value);
                    setResetErrorMsg(null);
                  }}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-colors"
                  placeholder={t('loginEmailPlaceholder')}
                />
              </div>
            </div>
            {resetErrorMsg && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-600">
                <AlertCircle aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
                {resetErrorMsg}
              </div>
            )}
            {resetMsg && (
              <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm font-medium text-emerald-700">
                {resetMsg}
              </div>
            )}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={closeResetModal}
                disabled={resetLoading}
                className="min-h-11 rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                {th ? 'ยกเลิก' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={resetLoading}
                className="min-h-11 rounded-xl bg-pink-600 px-4 py-2 text-sm font-bold text-white hover:bg-pink-700 disabled:opacity-50"
              >
                {resetLoading ? t('sendPasswordReset') : (th ? 'ส่งลิงก์' : 'Send reset link')}
              </button>
            </div>
          </form>
        </div>
      )}
    </PublicShell>
  );
};

export default ManageLogin;
