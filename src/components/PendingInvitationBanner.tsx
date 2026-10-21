import { useI18n, uiText } from '../i18n';
// src/components/PendingInvitationBanner.tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { Bell, Check } from 'lucide-react';
import { selectActorWorkspace } from '../utils/access';

export interface PendingInvite {
  id: string;
  artist_id: string;
  artist_name: string;
  role: string;
  invited_at: string;
  expires_at: string | null;
  event_ids?: string[];
}

const ROLE_LABELS: Record<string, string> = {
  manager: 'Manager',
  seller: 'Seller / POS Staff',
  queue_staff: 'Queue Staff',
};

// sessionStorage is intentional: "Not now" hides the banner for the current
// browser tab's lifetime (including page refreshes within the same tab).
// The banner reappears when the user opens a new tab or starts a new browser session.
// To permanently decline, use the /invitations settings page.
const SESSION_KEY = 'dismissed_invitations';

function getDismissed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function dismiss(id: string): void {
  const current = getDismissed();
  if (!current.includes(id)) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...current, id]));
  }
}

interface Props {
  invitations: PendingInvite[];
  onAccepted: () => void;
}

export default function PendingInvitationBanner({ invitations, onAccepted }: Props) {
  const { language } = useI18n();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [acceptedIds, setAcceptedIds] = useState<string[]>([]);
  const [localDismissed, setLocalDismissed] = useState<string[]>(getDismissed);
  const [errorId, setErrorId] = useState<string | null>(null);

  const shown = invitations.filter(
    (inv) => !acceptedIds.includes(inv.id) && !localDismissed.includes(inv.id)
  );

  if (shown.length === 0) return null;

  const handleAccept = async (inv: PendingInvite) => {
    setAcceptingId(inv.id);
    setErrorId(null);
    try {
      const { data, error } = await supabase.rpc('accept_team_invitation', {
        p_invitation_id: inv.id,
      });
      if (error) throw error;
      await selectActorWorkspace(inv.artist_id);
      setAcceptedIds((prev) => [...prev, inv.id]);
      onAccepted();
      const redirectPath = typeof data === 'object' && data && 'redirect_path' in data
        ? String((data as { redirect_path?: string }).redirect_path || '')
        : '';
      if (redirectPath) window.location.href = redirectPath;
    } catch (err) {
      console.error('[PendingInvitationBanner] accept failed:', err);
      setErrorId(inv.id);
    } finally {
      setAcceptingId(null);
    }
  };

  const handleNotNow = (inv: PendingInvite) => {
    dismiss(inv.id);
    setLocalDismissed((prev) => [...prev, inv.id]);
  };

  return (
    <div role="region" aria-label={uiText(language, "Pending team invitations")} className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
      {shown.map((inv) => (
        <div
          key={inv.id}
          className="bg-white border border-gray-200 rounded-xl shadow-lg p-4 flex flex-col gap-3"
        >
          <div className="flex items-start gap-3">
            <Bell size={16} className="text-pink-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 leading-snug">{uiText(language, " You've been invited to join")}{' '}
                <span className="text-pink-600">{inv.artist_name}</span>
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{uiText(language, " Role: ")}{uiText(language, ROLE_LABELS[inv.role] ?? inv.role)}
              </p>
              {errorId === inv.id && (
                <p className="text-xs text-red-500 mt-1">{uiText(language, "Failed to accept. Please try again.")}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleAccept(inv)}
              disabled={acceptingId === inv.id}
              aria-busy={acceptingId === inv.id}
              aria-label={language === 'th' ? `ตอบรับคำเชิญเข้าร่วม ${inv.artist_name}` : `Accept invitation to join ${inv.artist_name}`}
              className="flex-1 py-1.5 text-sm font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Check size={13} />
              {uiText(language, acceptingId === inv.id ? 'Accepting…' : 'Accept')}
            </button>
            <button
              type="button"
              onClick={() => handleNotNow(inv)}
              aria-label={language === 'th' ? `เก็บคำเชิญจาก ${inv.artist_name} ไว้ก่อน` : `Dismiss invitation from ${inv.artist_name} for now`}
              className="flex-1 py-1.5 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
            >{uiText(language, " Not now ")}</button>
          </div>
          <Link
            to="/invitations"
            className="text-xs text-center text-gray-400 hover:text-gray-600 underline"
          >{uiText(language, " Manage invitations ")}</Link>
        </div>
      ))}
    </div>
  );
}
