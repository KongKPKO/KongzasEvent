import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { signOutLocally } from '../utils/workspaceSession';
import { LanguageToggle, useI18n } from '../i18n';

type Access = 'checking' | 'denied' | 'setup' | 'verify' | 'allowed' | 'error';
type TotpFactor = { id: string; friendly_name?: string };

export default function PlatformAdminGate({ children, userId, accessToken }: {
  children: ReactNode;
  userId: string;
  accessToken: string;
}) {
  const { language } = useI18n();
  const th = language === 'th';
  const [access, setAccess] = useState<Access>('checking');
  const [authorizedToken, setAuthorizedToken] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [factorId, setFactorId] = useState('');
  const [enrollment, setEnrollment] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setAccess('checking');
    setError(null);
    const check = async () => {
      try {
        const account = await supabase.rpc('is_platform_admin_account');
        if (account.error) throw account.error;
        if (!active) return;
        if (!account.data) { setAccess('denied'); return; }
        const authorized = await supabase.rpc('is_platform_admin');
        if (authorized.error) throw authorized.error;
        if (!active) return;
        if (authorized.data) {
          setAuthorizedToken(accessToken);
          setEnrollment(null);
          setCode('');
          setAccess('allowed');
          return;
        }
        const listed = await supabase.auth.mfa.listFactors();
        if (listed.error) throw listed.error;
        if (!active) return;
        const verified = listed.data.totp.filter(factor => factor.status === 'verified');
        setFactors(verified);
        setFactorId(verified[0]?.id || '');
        setEnrollment(null);
        setCode('');
        setAccess(verified.length ? 'verify' : 'setup');
      } catch {
        if (active) setAccess('error');
      }
    };
    void check();
    return () => { active = false; };
  }, [userId, accessToken, attempt]);

  const enroll = async () => {
    setBusy(true);
    setError(null);
    try {
      const listed = await supabase.auth.mfa.listFactors();
      if (listed.error) throw listed.error;
      // Restart only unfinished setups; verified authenticators must remain usable.
      for (const factor of listed.data.all.filter(f => f.factor_type === 'totp' && f.status === 'unverified')) {
        const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (removed.error) throw removed.error;
      }
      const result = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'NireQ Platform Admin', issuer: 'NireQ' });
      if (result.error) throw result.error;
      setFactorId(result.data.id);
      setEnrollment({ qr: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.data.totp.qr_code.replace(/^data:image\/svg\+xml;utf-8,/, ''))}`, secret: result.data.totp.secret });
      setAccess('verify');
    } catch {
      setError(th ? 'ตั้งค่าตัวตรวจสอบไม่สำเร็จ กรุณาลองอีกครั้ง' : 'Could not set up your authenticator. Try again.');
    } finally { setBusy(false); }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !/^\d{6}$/.test(code) || !factorId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (result.error) throw result.error;
      setCode('');
      setEnrollment(null);
      setAttempt(current => current + 1);
    } catch {
      setCode('');
      setError(th ? 'ยืนยันไม่สำเร็จ ตรวจรหัสล่าสุดและเวลาบนอุปกรณ์ แล้วลองอีกครั้ง' : 'Verification failed. Check the latest code and your device time, then try again.');
    } finally { setBusy(false); }
  };

  const signOut = async () => {
    setBusy(true);
    try { await signOutLocally(userId); } catch {
      setError(th ? 'ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง' : 'Could not sign out. Try again.');
      setBusy(false);
    }
  };

  if (access === 'allowed' && authorizedToken === accessToken) return children;
  const button = 'min-h-11 rounded-xl border border-gray-300 px-4 py-2 font-bold focus-visible:outline-pink-600 disabled:opacity-50';
  return <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4 text-gray-900">
    <section className="w-full max-w-md space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm" aria-labelledby="admin-verification-title">
      <div className="flex items-center justify-between"><ShieldCheck className="text-pink-700" aria-hidden="true" /><LanguageToggle /></div>
      <h1 id="admin-verification-title" className="text-xl font-black">{th ? 'ยืนยันตัวตนผู้ดูแลระบบ' : 'Admin verification'}</h1>
      {access === 'checking' && <p role="status">{th ? 'กำลังตรวจสอบสิทธิ์…' : 'Checking access…'}</p>}
      {access === 'denied' && <p role="alert">{th ? 'เฉพาะบัญชีผู้ดูแลแพลตฟอร์มเท่านั้น' : 'Platform Admin access required.'}</p>}
      {access === 'error' && <><p role="alert">{th ? 'ตรวจสอบสิทธิ์ไม่สำเร็จ กรุณาลองอีกครั้ง' : 'Could not check access. Try again.'}</p><button className={button} onClick={() => setAttempt(current => current + 1)}>{th ? 'ลองอีกครั้ง' : 'Retry'}</button></>}
      {access === 'setup' && <><p>{th ? 'ตั้งค่าแอป Authenticator เพื่อปกป้องสิทธิ์ผู้ดูแลระบบ ต้องใช้รหัสจากแอปก่อนเข้าถึงข้อมูลของแพลตฟอร์ม' : 'Set up an authenticator app to protect admin access. A code is required before accessing platform data.'}</p><button className={`${button} bg-pink-700 text-white`} disabled={busy} onClick={() => void enroll()}>{busy ? (th ? 'กำลังตั้งค่า…' : 'Setting up…') : (th ? 'ตั้งค่า Authenticator' : 'Set up authenticator')}</button></>}
      {access === 'verify' && <form onSubmit={verify} className="space-y-4">
        {enrollment && <div className="space-y-3" data-private="true"><p>{th ? 'สแกน QR ด้วยแอป Authenticator แล้วกรอกรหัส 6 หลัก ห้ามแชร์ QR หรือคีย์นี้' : 'Scan the QR code with your authenticator app, then enter its six-digit code. Keep this QR and key private.'}</p><img className="mx-auto h-52 w-52" alt={th ? 'QR สำหรับตั้งค่า Authenticator ส่วนตัว' : 'Private authenticator setup QR'} src={enrollment.qr} /><label className="block text-sm font-bold">{th ? 'คีย์สำหรับตั้งค่าด้วยตนเอง' : 'Manual setup key'}<input className="mt-1 min-h-11 w-full rounded-xl border p-3" type="password" readOnly value={enrollment.secret} autoComplete="off" /></label></div>}
        {!enrollment && <p>{th ? 'กรอกรหัสจากแอป Authenticator ของคุณ หากใช้งานแอปไม่ได้ ให้ติดต่อผู้ดูแลเพื่อกู้คืนสิทธิ์' : 'Enter the code from your authenticator app. If you cannot access it, contact the administrator for recovery.'}</p>}
        {factors.length > 1 && <label className="block font-bold">{th ? 'Authenticator' : 'Authenticator'}<select className="mt-1 min-h-11 w-full rounded-xl border p-3" value={factorId} onChange={event => setFactorId(event.target.value)}>{factors.map((factor, index) => <option key={factor.id} value={factor.id}>{factor.friendly_name || `Authenticator ${index + 1}`}</option>)}</select></label>}
        <label className="block font-bold">{th ? 'รหัสยืนยัน 6 หลัก' : 'Six-digit code'}<input className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 p-3 focus-visible:outline-pink-600" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} data-private="true" /></label>
        <button className={`${button} w-full bg-pink-700 text-white`} disabled={busy || code.length !== 6}>{busy ? (th ? 'กำลังยืนยัน…' : 'Verifying…') : (th ? 'ยืนยันและดำเนินการต่อ' : 'Verify and continue')}</button>
      </form>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <nav className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><Link className="min-h-11 inline-flex items-center text-pink-700 underline" to="/">{th ? 'กลับหน้าหลัก' : 'Back to home'}</Link><button type="button" disabled={busy} className={button} onClick={() => void signOut()}>{th ? 'ออกจากระบบ' : 'Sign out'}</button></nav>
    </section>
  </main>;
}
