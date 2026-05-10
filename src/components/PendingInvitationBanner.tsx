// src/components/PendingInvitationBanner.tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { Bell, Check } from 'lucide-react';

export interface PendingInvite {
  id: string;
  artist_id: string;
  artist_name: string;
  role: string;
  invited_at: string;
  expires_at: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  manager: 'Manager',
  seller: 'Seller / POS Staff',
  queue_staff: 'Queue Staff',
};

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
  const dismissed = getDismissed();
  const visible = invitations.filter((inv) => !dismissed.includes(inv.id));

  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [acceptedIds, setAcceptedIds] = useState<string[]>([]);
  const [localDismissed, setLocalDismissed] = useState<string[]>([]);
  const [errorId, setErrorId] = useState<string | null>(null);

  const shown = visible.filter(
    (inv) => !acceptedIds.includes(inv.id) && !localDismissed.includes(inv.id)
  );

  if (shown.length === 0) return null;

  const handleAccept = async (inv: PendingInvite) => {
    setAcceptingId(inv.id);
    setErrorId(null);
    try {
      const { error } = await supabase.rpc('accept_team_invitation', {
        p_invitation_id: inv.id,
      });
      if (error) throw error;
      setAcceptedIds((prev) => [...prev, inv.id]);
      onAccepted();
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
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
      {shown.map((inv) => (
        <div
          key={inv.id}
          className="bg-white border border-gray-200 rounded-xl shadow-lg p-4 flex flex-col gap-3"
        >
          <div className="flex items-start gap-3">
            <Bell size={16} className="text-pink-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 leading-snug">
                You've been invited to join{' '}
                <span className="text-pink-600">{inv.artist_name}</span>
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Role: {ROLE_LABELS[inv.role] ?? inv.role}
              </p>
              {errorId === inv.id && (
                <p className="text-xs text-red-500 mt-1">Failed to accept. Please try again.</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleAccept(inv)}
              disabled={acceptingId === inv.id}
              className="flex-1 py-1.5 text-sm font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Check size={13} />
              {acceptingId === inv.id ? 'Accepting…' : 'Accept'}
            </button>
            <button
              type="button"
              onClick={() => handleNotNow(inv)}
              className="flex-1 py-1.5 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Not now
            </button>
          </div>
          <Link
            to="/invitations"
            className="text-xs text-center text-gray-400 hover:text-gray-600 underline"
          >
            Manage invitations
          </Link>
        </div>
      ))}
    </div>
  );
}
