import { uiText, useI18n } from '../i18n';
// src/pages/InvitationsPage.tsx
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import PublicShell from '../components/PublicShell';
import { Link } from 'react-router-dom';
import { Bell, LogOut, UserRound } from 'lucide-react';
import type { PendingInvite } from '../components/PendingInvitationBanner';
import { getAuthUserSafe } from '../utils/auth';
import { selectActorWorkspace } from '../utils/access';
import { signOutLocally } from '../utils/workspaceSession';

const ROLE_LABELS: Record<string, string> = {
  manager: 'Manager',
  seller: 'Seller / POS Staff',
  queue_staff: 'Queue Staff',
};

export default function InvitationsPage() {
  const { language } = useI18n();
  const th = language === 'th';
  const tr = (thai: string, english: string) => th ? thai : english;
  const [invitations, setInvitations] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [fetchError, setFetchError] = useState<string>('');
  const [signedInEmail, setSignedInEmail] = useState('');
  const [userId, setUserId] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');

  const fetchInvitations = async () => {
    setLoading(true);
    setFetchError('');
    try {
      const { data, error } = await supabase.rpc('list_my_pending_invitations');
      if (error) {
        setFetchError(tr('โหลดคำเชิญไม่ได้ กรุณาลองอีกครั้ง', 'Failed to load invitations. Please refresh.'));
      } else {
        setInvitations((data || []) as PendingInvite[]);
      }
    } catch {
      setFetchError(tr('โหลดคำเชิญไม่ได้ กรุณาลองอีกครั้ง', 'Failed to load invitations. Please refresh.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchInvitations();
    void getAuthUserSafe().then((user) => {
      setSignedInEmail(user?.email || '');
      setUserId(user?.id || '');
    }).catch(() => setFetchError('Failed to load your signed-in account. Please refresh.'));
  }, []);

  const handleAccept = async (inv: PendingInvite) => {
    if (actionId) return;
    setActionId(inv.id);
    try {
      const { data, error } = await supabase.rpc('accept_team_invitation', {
        p_invitation_id: inv.id,
      });
      if (error) throw error;
      await selectActorWorkspace(inv.artist_id);
      const redirectPath = typeof data === 'object' && data && 'redirect_path' in data
        ? String((data as { redirect_path?: string }).redirect_path || '/')
        : '/';
      window.location.href = redirectPath;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to accept invitation.';
      setMessages((m) => ({ ...m, [inv.id]: msg }));
    } finally {
      setActionId(null);
    }
  };

  const handleSwitchAccount = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError('');
    try {
      await signOutLocally(userId || null);
      window.location.replace('/manage-login?redirect=/invitations');
    } catch (failure) {
      setSignOutError(failure instanceof Error ? failure.message : 'Could not sign out. Please try again.');
      setSigningOut(false);
    }
  };

  const handleDecline = async (inv: PendingInvite) => {
    if (actionId) return;
    setActionId(inv.id);
    try {
      const { error } = await supabase.rpc('decline_team_invitation', {
        p_invitation_id: inv.id,
      });
      if (error) throw error;
      await fetchInvitations();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to decline invitation.';
      setMessages((m) => ({ ...m, [inv.id]: msg }));
    } finally {
      setActionId(null);
    }
  };

  return (
    <PublicShell>
      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex items-center gap-2 mb-6">
          <Bell size={18} className="text-gray-600" />
          <h1 className="text-xl font-black text-gray-800">{tr('คำเชิญของฉัน', 'My Invitations')}</h1>
        </div>

        <section className="mb-5 rounded-xl border border-gray-200 bg-white p-4" aria-label={uiText(language, 'Signed-in account')}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <UserRound size={18} className="shrink-0 text-gray-500" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs font-bold text-gray-500">{tr('เข้าสู่ระบบด้วย', 'Signed in as')}</p>
                <p className="truncate text-sm font-black text-gray-900">{signedInEmail || uiText(language, 'Loading account…')}</p>
              </div>
            </div>
            <button type="button" disabled={signingOut} onClick={() => void handleSwitchAccount()} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-60">
              <LogOut size={16} aria-hidden="true" />
              {uiText(language, signingOut ? 'Switching account…' : 'Use another account')}
            </button>
          </div>
          {signOutError && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{uiText(language, signOutError)}</p>}
        </section>

        {loading ? (
          <p className="text-sm text-gray-500">{tr('กำลังโหลด…', 'Loading…')}</p>
        ) : fetchError ? (
          <div role="alert" className="text-sm text-red-700">{fetchError}<button className="public-button ml-3" onClick={() => void fetchInvitations()}>{tr('ลองใหม่', 'Retry')}</button></div>
        ) : invitations.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-8 text-center">
            <p className="text-sm font-bold text-gray-600">{tr('ไม่มีคำเชิญที่รอตอบรับ', 'No pending invitations.')}</p>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-gray-500">{uiText(language, 'If you opened an invitation for another email address, use another account and sign in with the invited email.')}</p>
            <Link to="/manage-login" className="public-text-link mt-3 block">{tr('กลับเข้าสู่ระบบ', 'Back to sign in')}</Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {invitations.map((inv) => (
              <div
                key={inv.id}
                className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex flex-col gap-3"
              >
                <div>
                  <p className="text-sm font-semibold text-gray-800">{inv.artist_name}</p>
                  <p className="text-xs text-gray-500">
                    {th ? ({ manager: 'ผู้จัดการ', seller: 'พนักงานขาย / POS', queue_staff: 'ทีมงานคิว' } as Record<string, string>)[inv.role] || inv.role : ROLE_LABELS[inv.role] ?? inv.role} ·{' '}
                    {tr('เชิญเมื่อ', 'Invited')} {new Date(inv.invited_at).toLocaleDateString(th ? 'th-TH' : 'en-GB')}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-slate-700">{inv.role === 'manager' ? tr('ดูแลทุกอีเวนต์ สินค้า โปรโมชัน ขาย และคิวของร้าน', 'Manage all shop events, products, promotions, sales and queues') : inv.role === 'seller' ? tr('ขาย รับชำระเงิน และจัดการคิว เฉพาะอีเวนต์ที่ได้รับมอบหมาย', 'Sell, take payments and manage queues in assigned events') : tr('เรียกและจัดการคิว ไม่รับชำระเงิน', 'Call and manage queues; no checkout')}{inv.role !== 'manager' && <span className="block font-semibold">{tr('อีเวนต์ที่มอบหมาย', 'Assigned events')}: {inv.event_ids?.length || 0} · {tr('ดูรายละเอียดในพื้นที่ทำงานหลังตอบรับ', 'View details in your workspace after accepting')}</span>}</p>
                  {inv.expires_at && <p className="mt-2 text-xs text-slate-600">{tr('ตอบรับภายใน', 'Accept before')} {new Date(inv.expires_at).toLocaleString(th ? 'th-TH' : 'en-GB')}</p>}
                  {messages[inv.id] && (
                    <p role="alert" className="text-xs text-red-700 mt-1">{messages[inv.id]}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleAccept(inv)}
                    disabled={!!actionId}
                    className="public-button public-primary"
                  >
                    {actionId === inv.id ? tr('กำลังดำเนินการ…', 'Processing…') : tr('ตอบรับคำเชิญ', 'Accept')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDecline(inv)}
                    disabled={!!actionId}
                    className="public-button"
                  >
                    {tr('ปฏิเสธ', 'Decline')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </PublicShell>
  );
}
