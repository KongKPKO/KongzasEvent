import { useI18n, uiText, LanguageToggle } from '../i18n';
// src/pages/InvitationsPage.tsx
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Bell } from 'lucide-react';
import type { PendingInvite } from '../components/PendingInvitationBanner';

const ROLE_LABELS: Record<string, string> = {
  manager: 'Manager',
  seller: 'Seller / POS Staff',
  queue_staff: 'Queue Staff',
};

export default function InvitationsPage() {
  const { language, dateLocale } = useI18n();
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
        setFetchError('Failed to load invitations. Please refresh.');
      } else {
        setInvitations((data || []) as PendingInvite[]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchInvitations(); }, []);

  const handleAccept = async (inv: PendingInvite) => {
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
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex items-center gap-2 mb-6">
          <Bell size={18} className="text-gray-600" />
          <h1 className="text-xl font-black text-gray-800">{uiText(language, "My Invitations")}</h1><LanguageToggle className="ml-auto" />
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">{uiText(language, "Loading…")}</p>
        ) : fetchError ? (
          <p className="text-sm text-red-500">{uiText(language, fetchError)}</p>
        ) : invitations.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-8 text-center text-sm text-gray-400">{uiText(language, " No pending invitations. ")}</div>
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
                    {uiText(language, ROLE_LABELS[inv.role] ?? inv.role)} ·{' '}{uiText(language, " Invited ")}{new Date(inv.invited_at).toLocaleDateString(dateLocale)}
                  </p>
                  {messages[inv.id] && (
                    <p className="text-xs text-red-500 mt-1">{uiText(language, messages[inv.id])}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleAccept(inv)}
                    disabled={actionId === inv.id}
                    className="px-4 py-1.5 text-sm font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
                  >
                    {uiText(language, actionId === inv.id ? 'Processing…' : 'Accept')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDecline(inv)}
                    disabled={actionId === inv.id}
                    className="px-4 py-1.5 text-sm border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >{uiText(language, " Decline ")}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
