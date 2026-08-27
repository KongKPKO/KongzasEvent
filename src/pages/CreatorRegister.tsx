import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { AlertCircle, ArrowLeft, CheckCircle2, ExternalLink, Lock, Mail, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { LanguageToggle, useI18n } from '../i18n';
import { completePendingVerifiedCreatorSignup, fetchActorContext } from '../utils/access';
import { getAuthRedirectError } from '../utils/authRedirect';

type FormState = {
  email: string;
  password: string;
  confirmPassword: string;
  contactName: string;
  creatorName: string;
  desiredSlug: string;
  primarySocialUrl: string;
  websiteUrl: string;
  instagramUrl: string;
  xUrl: string;
  facebookUrl: string;
  tiktokUrl: string;
  applicationNote: string;
  truthful: boolean;
};

const initialForm: FormState = {
  email: '',
  password: '',
  confirmPassword: '',
  contactName: '',
  creatorName: '',
  desiredSlug: '',
  primarySocialUrl: '',
  websiteUrl: '',
  instagramUrl: '',
  xUrl: '',
  facebookUrl: '',
  tiktokUrl: '',
  applicationNote: '',
  truthful: false,
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);

const normalizeOptionalUrl = (value: string) => value.trim() || null;

const isExistingAccountResponse = (errorMessage: string | null | undefined) => {
  const normalized = String(errorMessage || '').toLowerCase();
  return normalized.includes('already registered') || normalized.includes('already exists');
};

export default function CreatorRegister() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(() => getAuthRedirectError());
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [googleLoading, setGoogleLoading] = useState(false);
  const authRequestRef = useRef(0);
  const authUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    const applySessionUser = async (user: User | null) => {
      if (!active) return;
      const request = ++authRequestRef.current;
      const userId = user?.id || null;

      if (authUserIdRef.current !== userId) setForm(initialForm);

      authUserIdRef.current = userId;
      setAuthUser(user);
      setAuthLoading(false);
      if (!user) return;

      const actor = await fetchActorContext();
      if (!active || request !== authRequestRef.current || authUserIdRef.current !== user.id) return;
      if (actor) {
        navigate('/manage-login', { replace: true });
        return;
      }

      setForm((current) => {
        if (!active || request !== authRequestRef.current || authUserIdRef.current !== user.id) return current;
        const email = user.email || '';
        const suggestedContactName = String(user.user_metadata?.full_name || user.user_metadata?.name || '');
        const contactName = current.contactName || suggestedContactName;
        return { ...current, email, contactName };
      });
    };

    void supabase.auth.getSession().then(({ data }) => applySessionUser(data.session?.user || null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySessionUser(session?.user || null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [navigate]);

  const slugValid = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(form.desiredSlug);
  const hasSocialProof = form.primarySocialUrl.trim().startsWith('http');
  const noteValid = form.applicationNote.trim().length >= 20;
  const passwordsMatch = authUser
    ? true
    : form.password.length >= 8 && form.password === form.confirmPassword;
  const incompleteReasons = [
    !form.email.trim() && t('registerErrEmail'),
    !passwordsMatch && t('registerErrPassword'),
    form.contactName.trim().length < 2 && t('registerErrContact'),
    form.creatorName.trim().length < 2 && t('registerErrCreator'),
    !slugValid && t('registerErrSlug'),
    !hasSocialProof && t('registerErrSocial'),
    !noteValid && t('registerErrNote', { count: Math.max(0, 20 - form.applicationNote.trim().length) }),
    !form.truthful && t('registerErrTruthful'),
  ].filter(Boolean) as string[];

  const canSubmit = useMemo(() => {
    return (
      form.email.trim().length > 3 &&
      passwordsMatch &&
      form.contactName.trim().length >= 2 &&
      form.creatorName.trim().length >= 2 &&
      slugValid &&
      hasSocialProof &&
      noteValid &&
      form.truthful
    );
  }, [form, hasSocialProof, noteValid, passwordsMatch, slugValid]);

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleCreatorNameChange = (value: string) => {
    setForm((current) => ({
      ...current,
      creatorName: value,
      desiredSlug: current.desiredSlug ? current.desiredSlug : slugify(value),
    }));
  };

  const handleGoogleSignup = async () => {
    setGoogleLoading(true);
    setErrorMsg(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/creator/register`,
      },
    });
    if (error) {
      setErrorMsg(t('googleLoginFailed'));
      setGoogleLoading(false);
    }
  };

  const resolveSubmitError = (error: unknown) => {
    const rawMessage = error instanceof Error ? error.message : String(error || '');
    const normalized = rawMessage.toLowerCase();

    if (normalized.includes('workspace already exists')) return t('registerErrWorkspaceExists');
    if (normalized.includes('desired url slug is already taken') || (normalized.includes('slug') && normalized.includes('duplicate'))) return t('registerErrSlugTaken');
    if (normalized.includes('already registered') || normalized.includes('already exists')) return t('registerErrEmailExists');
    if (normalized.includes('row-level security')) return t('registerErrSubmit');
    return rawMessage || t('registerErrSubmit');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);

    if (!canSubmit) {
      setErrorMsg(t('registerErrComplete'));
      return;
    }

    setLoading(true);

    try {
      const email = form.email.trim().toLowerCase();
      const desiredSlug = form.desiredSlug.trim();

      const { data: slugAvailable, error: slugCheckError } = await supabase.rpc('is_creator_slug_available', {
        p_slug: desiredSlug,
      });

      if (slugCheckError) {
        console.warn('[CreatorRegister] Slug availability check failed:', slugCheckError);
      }

      if (slugAvailable === false) {
        throw new Error('Desired URL slug is already taken');
      }

      const creatorMetadata = {
        creator_signup: 'self_serve',
        creator_name: form.creatorName.trim(),
        contact_name: form.contactName.trim(),
        desired_slug: desiredSlug,
        primary_social_url: form.primarySocialUrl.trim(),
        website_url: normalizeOptionalUrl(form.websiteUrl),
        instagram_url: normalizeOptionalUrl(form.instagramUrl),
        x_url: normalizeOptionalUrl(form.xUrl),
        facebook_url: normalizeOptionalUrl(form.facebookUrl),
        tiktok_url: normalizeOptionalUrl(form.tiktokUrl),
        application_note: form.applicationNote.trim(),
      };

      if (authUser) {
        const { error: metadataError } = await supabase.auth.updateUser({ data: creatorMetadata });
        if (metadataError) throw metadataError;

        const completion = await completePendingVerifiedCreatorSignup();
        if (completion === 'created' || completion === 'exists') {
          navigate('/manage-login', { replace: true });
          return;
        }
        if (completion === 'email_unconfirmed') throw new Error(t('loginConfirmEmailFirst'));
        throw new Error(t('registerErrSubmit'));
      }

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password: form.password,
        options: {
          emailRedirectTo: `${window.location.origin}/manage-login?verified=1`,
          data: creatorMetadata,
        },
      });

      if (signUpError && !isExistingAccountResponse(signUpError.message)) throw signUpError;

      if (signUpData?.session) await supabase.auth.signOut();

      setSubmittedEmail(email);
      setForm(initialForm);
    } catch (error) {
      setErrorMsg(resolveSubmitError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (!submittedEmail || resendLoading) return;
    setResendLoading(true);
    setResendMessage(null);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: submittedEmail,
        options: { emailRedirectTo: `${window.location.origin}/manage-login?verified=1` },
      });
      if (error) throw error;
      setResendMessage(t('registerResendNeutral'));
    } catch {
      setResendMessage(t('registerResendUnavailable'));
    } finally {
      setResendLoading(false);
    }
  };

  if (submittedEmail) {
    return (
      <div className="min-h-screen bg-[#f7f4ef] px-4 py-8 text-gray-900">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-xl items-center">
          <div className="w-full rounded-[2rem] border border-emerald-200 bg-white p-8 shadow-xl">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
              <CheckCircle2 size={30} />
            </div>
            <h1 className="text-3xl font-black tracking-tight">{t('registerApplicationReceived')}</h1>
            <p className="mt-3 text-sm leading-6 text-gray-600">
              {t('registerApplicationReceivedBody', { email: submittedEmail })}
            </p>
            <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
              {t('registerApplicationLocked')}
            </div>
            {resendMessage && <p className="mt-4 rounded-xl border border-pink-100 bg-pink-50 p-3 text-sm font-semibold text-pink-900" role="status">{resendMessage}</p>}
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/manage-login"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-gray-900 px-4 py-3 text-sm font-bold text-white hover:bg-black"
              >
                <ArrowLeft size={16} />
                {t('registerBackLogin')}
              </Link>
              <button type="button" onClick={handleResendConfirmation} disabled={resendLoading} className="min-h-11 rounded-xl border border-pink-200 bg-white px-4 py-3 text-sm font-black text-pink-700 hover:bg-pink-50 disabled:opacity-60">
                {resendLoading ? 'กำลังส่ง…' : 'ส่งอีเมลยืนยันอีกครั้ง'}
              </button>
            </div>
            <p className="mt-3 text-sm text-gray-600">{t('registerResetGuidance')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f4ef] text-gray-900">
      <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 lg:grid-cols-[0.95fr_1.05fr]">
        <aside className="flex flex-col justify-between px-6 py-8 lg:px-10">
          <Link to="/manage-login" className="inline-flex items-center gap-2 text-sm font-bold text-gray-600 hover:text-gray-950">
            <ArrowLeft size={16} />
            {t('registerBack')}
          </Link>
          <div className="mt-4">
            <LanguageToggle />
          </div>

          <div className="py-12">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-emerald-800">
              <Sparkles size={14} />
              {t('registerEyebrow')}
            </div>
            <h1 className="max-w-md text-5xl font-black leading-[0.95] tracking-tight md:text-6xl">
              {t('registerHeroTitle')}
            </h1>
            <p className="mt-6 max-w-md text-base leading-7 text-gray-600">
              {t('registerHeroBody')}
            </p>
          </div>

          <div className="grid gap-3 text-sm">
            <div className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white/70 p-4">
              <ShieldCheck className="mt-0.5 text-emerald-700" size={20} />
              <p className="text-gray-600"><span className="font-bold text-gray-900">{t('registerManualTitle')}</span> {t('registerManualBody')}</p>
            </div>
            <div className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white/70 p-4">
              <ExternalLink className="mt-0.5 text-pink-700" size={20} />
              <p className="text-gray-600"><span className="font-bold text-gray-900">{t('registerSocialTitle')}</span> {t('registerSocialBody')}</p>
            </div>
          </div>
        </aside>

        <main className="px-4 py-6 lg:py-8">
          <form
            onSubmit={handleSubmit}
            aria-label={t('registerFormTitle')}
            data-testid="creator-register-form"
            className="rounded-[2rem] border border-gray-200 bg-white p-5 shadow-xl md:p-8"
          >
            <div className="mb-6 flex items-center justify-between gap-4 border-b border-gray-100 pb-5">
              <div>
                <h2 className="text-2xl font-black">{t('registerFormTitle')}</h2>
                <p className="mt-1 text-sm text-gray-500">{t('registerFormSubtitle')}</p>
              </div>
              <div className="hidden h-12 w-12 items-center justify-center rounded-2xl bg-gray-900 text-white md:flex">
                <UserRound size={22} />
              </div>
            </div>

            {errorMsg && (
              <div className="mb-5 flex items-start gap-2 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-semibold text-red-700">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                {errorMsg}
              </div>
            )}

            {!authLoading && !authUser && (
              <div className="mb-6 space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <button
                  type="button"
                  onClick={() => void handleGoogleSignup()}
                  disabled={googleLoading}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-black text-gray-900 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:opacity-60"
                >
                  <img
                    src="/google-g-logo.svg"
                    alt=""
                    aria-hidden="true"
                    data-testid="google-auth-logo"
                    className="h-5 w-5 shrink-0"
                  />
                  {googleLoading ? t('loginSubmitting') : t('continueWithGoogle')}
                </button>
                <p className="text-xs leading-5 text-gray-500">{t('googleSameEmailHint')}</p>
                <div className="flex items-center gap-3 text-xs font-bold text-gray-400">
                  <span className="h-px flex-1 bg-gray-200" />
                  {t('orUseEmail')}
                  <span className="h-px flex-1 bg-gray-200" />
                </div>
              </div>
            )}

            <div className="grid gap-5 md:grid-cols-2">
              {authUser ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 md:col-span-2">
                  <p className="text-xs font-black uppercase tracking-wide text-emerald-800">{t('registerSignedInAs')}</p>
                  <p className="mt-1 break-all text-sm font-bold text-gray-900">{authUser.email}</p>
                </div>
              ) : (
                <>
                  <Field label={t('registerEmail')} required>
                    <IconInput id="creator-email" name="email" icon={<Mail size={17} />} type="email" autoComplete="email" value={form.email} onChange={(value) => updateField('email', value)} placeholder={t('registerEmailPlaceholder')} />
                  </Field>
                  <Field label={t('registerPassword')} required hint={t('registerPasswordHint')}>
                    <IconInput id="creator-password" name="password" icon={<Lock size={17} />} type="password" autoComplete="new-password" value={form.password} onChange={(value) => updateField('password', value)} placeholder={t('registerPasswordPlaceholder')} />
                  </Field>
                  <Field label={t('registerConfirmPassword')} required>
                    <IconInput id="creator-confirm-password" name="confirmPassword" icon={<Lock size={17} />} type="password" autoComplete="new-password" value={form.confirmPassword} onChange={(value) => updateField('confirmPassword', value)} placeholder={t('registerConfirmPasswordPlaceholder')} />
                  </Field>
                </>
              )}
              <Field label={t('registerContactName')} required>
                <IconInput id="creator-contact-name" name="contactName" icon={<UserRound size={17} />} value={form.contactName} onChange={(value) => updateField('contactName', value)} placeholder={t('registerContactNamePlaceholder')} />
              </Field>
              <Field label={t('registerCreatorName')} required>
                <input id="creator-name" name="creatorName" className="input-surface" value={form.creatorName} onChange={(event) => handleCreatorNameChange(event.target.value)} placeholder={t('registerCreatorNamePlaceholder')} required />
              </Field>
              <Field label={t('registerSlug')} required hint={t('registerSlugHint')}>
                <input id="creator-slug" name="desiredSlug" className="input-surface" value={form.desiredSlug} onChange={(event) => updateField('desiredSlug', slugify(event.target.value))} placeholder={t('registerSlugPlaceholder')} required />
              </Field>
              <Field label={t('registerPrimarySocial')} required hint={t('registerPrimarySocialHint')}>
                <input id="creator-primary-social" name="primarySocialUrl" data-testid="creator-primary-social" className="input-surface" type="url" value={form.primarySocialUrl} onChange={(event) => updateField('primarySocialUrl', event.target.value)} placeholder={t('registerPrimarySocialPlaceholder')} required />
              </Field>
              <Field label={t('registerWebsite')}>
                <input id="creator-website" name="websiteUrl" className="input-surface" type="url" value={form.websiteUrl} onChange={(event) => updateField('websiteUrl', event.target.value)} placeholder="https://your-site.com" />
              </Field>
              <Field label={t('registerInstagram')}>
                <input id="creator-instagram" name="instagramUrl" className="input-surface" type="url" value={form.instagramUrl} onChange={(event) => updateField('instagramUrl', event.target.value)} placeholder="https://instagram.com/..." />
              </Field>
              <Field label={t('registerX')}>
                <input id="creator-x" name="xUrl" className="input-surface" type="url" value={form.xUrl} onChange={(event) => updateField('xUrl', event.target.value)} placeholder="https://x.com/..." />
              </Field>
              <Field label={t('registerFacebook')}>
                <input id="creator-facebook" name="facebookUrl" className="input-surface" type="url" value={form.facebookUrl} onChange={(event) => updateField('facebookUrl', event.target.value)} placeholder="https://facebook.com/..." />
              </Field>
              <Field label={t('registerTiktok')}>
                <input id="creator-tiktok" name="tiktokUrl" className="input-surface" type="url" value={form.tiktokUrl} onChange={(event) => updateField('tiktokUrl', event.target.value)} placeholder="https://tiktok.com/@..." />
              </Field>
            </div>

            <Field label={t('registerUseTitle')} required hint={t('registerUseHint')}>
              <textarea
                className="input-surface min-h-32 resize-y"
                id="creator-application-note"
                name="applicationNote"
                data-testid="creator-application-note"
                value={form.applicationNote}
                onChange={(event) => updateField('applicationNote', event.target.value)}
                placeholder={t('registerUsePlaceholder')}
                required
              />
            </Field>
            <div className={`mt-1 text-right text-xs font-bold ${noteValid ? 'text-emerald-700' : 'text-gray-500'}`}>
              {form.applicationNote.trim().length}/20 {t('registerMinimumChars')}
            </div>

            <label className="mt-5 flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
              <input
                type="checkbox"
                id="creator-truthful"
                name="truthful"
                data-testid="creator-truthful"
                checked={form.truthful}
                onChange={(event) => updateField('truthful', event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-700 focus:ring-emerald-600"
              />
              <span>
                {t('registerTruthful')}{' '}
                <Link to="/terms" className="font-bold text-pink-700 underline underline-offset-2">ข้อกำหนด</Link>
                {' '}และ{' '}
                <Link to="/privacy" className="font-bold text-pink-700 underline underline-offset-2">นโยบายความเป็นส่วนตัว</Link>
              </span>
            </label>

            <button
              type="submit"
              data-testid="creator-register-submit"
              disabled={!canSubmit || loading}
              className="mt-6 w-full rounded-2xl bg-gray-900 px-5 py-4 text-sm font-black text-white shadow-lg shadow-gray-200 transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
              title={!canSubmit && incompleteReasons.length > 0 ? incompleteReasons[0] : undefined}
            >
              {loading
                ? t('registerSubmitting')
                : canSubmit
                  ? t(authUser ? 'registerSubmitAuthenticated' : 'registerSubmit')
                  : t('registerCompleteRequired')}
            </button>

            {!canSubmit && incompleteReasons.length > 0 && (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                {incompleteReasons[0]}
              </div>
            )}
          </form>
        </main>
      </div>
    </div>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="mt-4 block">
      <span className="mb-1.5 flex items-center gap-1 text-sm font-black text-gray-800">
        {label}
        {required && <span className="text-pink-600">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs font-medium text-gray-500">{hint}</span>}
    </label>
  );
}

function IconInput({ id, name, icon, value, onChange, type = 'text', placeholder, autoComplete }: {
  id: string;
  name: string;
  icon: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{icon}</div>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="input-surface input-with-icon"
        placeholder={placeholder}
        required
      />
    </div>
  );
}
