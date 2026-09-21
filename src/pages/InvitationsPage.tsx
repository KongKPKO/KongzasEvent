// src/pages/InvitationsPage.tsx
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import PublicShell from '../components/PublicShell';
import { useI18n } from '../i18n';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import type { PendingInvite } from '../components/PendingInvitationBanner';

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

  useEffect(() => { void fetchInvitations(); }, []);

  const handleAccept = async (inv: PendingInvite) => {
    if (actionId) return;
    setActionId(inv.id);
    try {
      const { data, error } = await supabase.rpc('accept_team_invitation', {
        p_invitation_id: inv.id,
      });
      if (error) throw error;
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

        {loading ? (
          <p className="text-sm text-gray-500">{tr('กำลังโหลด…', 'Loading…')}</p>
        ) : fetchError ? (
          <div role="alert" className="text-sm text-red-700">{fetchError}<button className="public-button ml-3" onClick={() => void fetchInvitations()}>{tr('ลองใหม่', 'Retry')}</button></div>
        ) : invitations.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-8 text-center text-sm text-gray-600">
            {tr('ไม่มีคำเชิญที่รอตอบรับ', 'No pending invitations.')}
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
