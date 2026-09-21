import { Link } from 'react-router-dom';
import './team-workspace.css';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import AdminHeader from '../../components/AdminHeader';
import { Button } from '../../components/ui';
import { useI18n } from '../../i18n';
import type { ActorContext, ActorRole } from '../../types/access';
import { CalendarDays, UserPlus, Users, Shield, Trash2, Search, Clock, Send, X } from 'lucide-react';
import { invokeNotificationFunction } from '../../utils/edgeFunctions';

interface TeamMember {
  id: string;
  member_email: string;
  role: ActorRole;
  status: 'active' | 'inactive';
  created_at: string;
  can_manage_shipping: boolean;
}

interface TeamEvent {
  id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  status: string;
}

interface EventAssignment {
  id: string;
  member_id: string;
  event_id: string;
}

interface PendingInvitation {
  id: string;
  invited_email: string;
  role: ActorRole;
  invited_at: string;
  expires_at: string | null;
  event_ids?: string[];
}

type InviteResult =
  | 'member_added'
  | 'invitation_sent'
  | 'already_member'
  | 'already_invited'
  | 'email_failed'
  | null;

interface ManageTeamProps {
  actorContext: ActorContext;
}

const withTimeout = async <T,>(promiseLike: PromiseLike<T>, ms = 15000): Promise<T> => {
  const promise = Promise.resolve(promiseLike);
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('Request timed out. Please try again.')), ms);
    }),
  ]);
};

const getErrorMessage = (err: unknown, fallback: string) => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
};

const ROLE_OPTIONS: Array<{ value: ActorRole; label: string; detail: string }> = [
  { value: 'manager', label: 'Manager', detail: 'Events, menu, catalog, dashboard, queue, and POS. Invite and remove sellers and queue staff.' },
  { value: 'seller', label: 'Seller / POS Staff', detail: 'Queue plus checkout and payment for assigned events.' },
  { value: 'queue_staff', label: 'Queue Staff', detail: 'Queue calling and booth flow only. No checkout.' },
];

const getRoleLabel = (role: ActorRole) => {
  if (role === 'owner') return 'Owner';
  return ROLE_OPTIONS.find((option) => option.value === role)?.label || role;
};

export default function ManageTeam({ actorContext }: ManageTeamProps) {
  const { language } = useI18n();
  const th = language === 'th';
  const tr = (thai: string, english: string) => th ? thai : english;
  const roleLabel = (value: ActorRole) => th ? ({ owner: 'เจ้าของร้าน', manager: 'ผู้จัดการ', seller: 'พนักงานขาย / POS', queue_staff: 'ทีมงานคิว' })[value] : getRoleLabel(value);
  const roleDetail = (value: ActorRole) => value === 'owner' ? tr('จัดการร้าน ทีม และสิทธิ์ทั้งหมด', 'Manages the shop, team and all permissions') : value === 'manager' ? tr('จัดการสินค้า อีเวนต์ โปรโมชัน ขาย และคิว เชิญหรือนำพนักงานขายและทีมงานคิวออกได้', 'Manages catalog, events, promotions, POS and queues; invites and removes event staff') : value === 'seller' ? tr('เรียกคิว ขาย และรับชำระเงินในอีเวนต์ที่เข้าถึงได้', 'Queue, checkout and payment in accessible events') : tr('เรียกและจัดการคิว ไม่รับชำระเงิน', 'Calls and manages queues; no checkout');
  const [memberSearch, setMemberSearch] = useState('');
  const [loadErrors, setLoadErrors] = useState<Record<string, boolean>>({});
  const [accessReady, setAccessReady] = useState(false);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);
  const [events, setEvents] = useState<TeamEvent[]>([]);
  const [assignments, setAssignments] = useState<EventAssignment[]>([]);
  const [savingAssignmentsId, setSavingAssignmentsId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ActorRole>('queue_staff');
  const [inviteEventIds, setInviteEventIds] = useState<string[]>([]);
  const [eventAccessSearch, setEventAccessSearch] = useState('');
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [inviteResult, setInviteResult] = useState<InviteResult>(null);
  const [inviteResultMsg, setInviteResultMsg] = useState<string>('');
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendResultId, setResendResultId] = useState<string | null>(null);
  const [resendResultOk, setResendResultOk] = useState<boolean | null>(null);
  const [memberActionError, setMemberActionError] = useState<string>('');

  const isOwner = actorContext.role === 'owner';
  const inviteRoleOptions = ROLE_OPTIONS.filter(option => isOwner || option.value !== 'manager');
  const inviteRequiresEventAccess = role === 'seller' || role === 'queue_staff';
  const canSave = useMemo(
    () => email.trim().length > 3 && (!inviteRequiresEventAccess || inviteEventIds.length > 0),
    [email, inviteEventIds.length, inviteRequiresEventAccess]
  );
  const filteredEvents = useMemo(() => {
    const query = eventAccessSearch.trim().toLowerCase();
    if (!query) return events;
    return events.filter((event) => event.event_name.toLowerCase().includes(query));
  }, [eventAccessSearch, events]);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const { data, error } = await withTimeout(
        supabase
          .from('artist_members')
          .select('id, member_email, role, status, created_at, can_manage_shipping')
          .eq('artist_id', actorContext.artist_id)
          .order('created_at', { ascending: true })
      );

      if (error) throw error;
      else {
        setLoadErrors(current => ({ ...current, members: false }));
        setMembers((data || []) as TeamMember[]);
      }
    } catch (error) {
      console.error('[ManageTeam] fetch members request failed:', error);
      setLoadErrors(current => ({ ...current, members: true }));
    } finally {
      setLoading(false);
    }
  };

  const fetchEventsAndAssignments = async () => {
    try {
      const [{ data: eventData, error: eventError }, { data: assignmentData, error: assignmentError }] = await Promise.all([
        withTimeout(
          supabase
            .from('events')
            .select('id, event_name, start_date, end_date, status')
            .eq('artist_id', actorContext.artist_id)
            .order('start_date', { ascending: true })
        ),
        withTimeout(
          supabase
            .from('event_member_assignments')
            .select('id, member_id, event_id')
            .eq('artist_id', actorContext.artist_id)
        ),
      ]);

      if (eventError) throw eventError;
      if (assignmentError) throw assignmentError;
      setAccessReady(true);
      setLoadErrors(current => ({ ...current, access: false }));
      setEvents((eventData || []) as TeamEvent[]);
      setAssignments((assignmentData || []) as EventAssignment[]);
    } catch (error) {
      console.error('[ManageTeam] fetch events/assignments failed:', error);
      setAccessReady(false);
      setLoadErrors(current => ({ ...current, access: true }));
    }
  };

  const fetchPendingInvitations = async () => {
    try {
      const { data, error } = await withTimeout(
        supabase.rpc('list_team_invitations', { p_artist_id: actorContext.artist_id })
      );
      if (error) throw error;
      setPendingInvitations((data || []) as PendingInvitation[]);
      setLoadErrors(current => ({ ...current, invitations: false }));
    } catch (err) {
      console.error('[ManageTeam] fetch pending invitations failed:', err);
      setLoadErrors(current => ({ ...current, invitations: true }));
    }
  };

  useEffect(() => {
    fetchMembers();
    fetchEventsAndAssignments();
    fetchPendingInvitations();
  }, [actorContext.artist_id]);

  const getMemberAssignedEventIds = (memberId: string) =>
    new Set(assignments.filter((assignment) => assignment.member_id === memberId).map((assignment) => assignment.event_id));

  const getEventName = (eventId: string) => events.find((event) => event.id === eventId)?.event_name || tr('อีเวนต์ที่ไม่พร้อมแสดง', 'Unavailable event');

  const getInvitationRedirectUrl = () => `${window.location.origin}/invitations`;

  const toggleInviteEvent = (eventId: string) => {
    setInviteEventIds((current) =>
      current.includes(eventId)
        ? current.filter((id) => id !== eventId)
        : [...current, eventId]
    );
  };

  const saveMemberAssignments = async (member: TeamMember, nextEventIds: string[]) => {
    if (!isOwner || savingAssignmentsId || !accessReady) return;
    if (!nextEventIds.length && !confirm(tr('ล้างข้อจำกัดแล้วทีมงานคนนี้จะเข้าถึงทุกอีเวนต์ตามบทบาท รวมถึงอีเวนต์ใหม่ ต้องการดำเนินการหรือไม่?', 'Removing all restrictions grants access to every event for this role, including future events. Continue?'))) return;
    setSavingAssignmentsId(member.id);
    setMemberActionError('');
    try {
      const current = getMemberAssignedEventIds(member.id);
      const added = nextEventIds.filter(id => !current.has(id));
      const removed = [...current].filter(id => !nextEventIds.includes(id));
      if (added.length) {
        const { error } = await withTimeout(supabase.from('event_member_assignments').insert(added.map(eventId => ({ artist_id: actorContext.artist_id, member_id: member.id, event_id: eventId }))));
        if (error) throw error;
      }
      if (removed.length) {
        const { error } = await withTimeout(supabase.from('event_member_assignments').delete().eq('member_id', member.id).in('event_id', removed));
        if (error) throw error;
      }
      await fetchEventsAndAssignments();
    } catch (error) {
      setMemberActionError(tr('บันทึกสิทธิ์ไม่ครบ กำลังโหลดสิทธิ์จริงล่าสุด กรุณาตรวจอีกครั้ง', 'Access update did not complete. Reloading saved access; review before retrying.'));
      await fetchEventsAndAssignments();
    } finally {
      setSavingAssignmentsId(null);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || adding) return;

    setAdding(true);
    setInviteResult(null);
    setInviteResultMsg('');
    const normalizedEmail = email.trim().toLowerCase();

    try {
      const { data, error } = await withTimeout(
        supabase.rpc('invite_team_member', {
          p_artist_id: actorContext.artist_id,
          p_email: normalizedEmail,
          p_role: role,
          p_event_ids: inviteRequiresEventAccess ? inviteEventIds : [],
        })
      );

      if (error) throw error;

      const result = (data as { result: string; invitation_id?: string }).result;
      const invitationId = (data as { result: string; invitation_id?: string }).invitation_id;

      if (result === 'invitation_sent' && invitationId) {
        if (role === 'seller' || role === 'queue_staff') {
          const { error: magicLinkError } = await withTimeout(
            supabase.auth.signInWithOtp({
              email: normalizedEmail,
              options: {
                emailRedirectTo: getInvitationRedirectUrl(),
              },
            })
          );
          if (magicLinkError) {
            setInviteResult('email_failed');
            setInviteResultMsg(tr('สร้างคำเชิญแล้ว แต่ส่งลิงก์เข้าใช้งานไม่สำเร็จ ตรวจการตั้งค่าอีเมลแล้วกดส่งอีกครั้ง', 'Invitation created, but the magic link email failed to send. Use Resend after checking auth email settings.'));
          } else {
            setInviteResult('invitation_sent');
            setInviteResultMsg(tr('ส่งลิงก์เข้าใช้งานแล้ว ผู้รับเปิดอีเมลและตอบรับเพื่อทำงานในอีเวนต์ที่เลือกได้', 'Magic link sent. Staff can open the email, accept the invite, and work only the selected event access.'));
          }
        } else {
          try {
            const { error: notifyError } = await withTimeout(
              invokeNotificationFunction('notify-team-invitation', { invitation_id: invitationId })
            );
            if (notifyError) {
              setInviteResult('email_failed');
              setInviteResultMsg(tr('สร้างคำเชิญแล้ว แต่ส่งอีเมลไม่สำเร็จ กรุณากดส่งอีกครั้ง', 'Invitation created, but the notification email failed to send.'));
            } else {
              setInviteResult('invitation_sent');
              setInviteResultMsg(tr('ส่งคำเชิญผู้จัดการแล้ว ผู้รับสร้างบัญชีผู้จัดการได้โดยไม่ต้องสร้างร้านครีเอเตอร์', 'Manager invitation sent. They can create a password-based manager account without a creator profile.'));
            }
          } catch {
            setInviteResult('email_failed');
            setInviteResultMsg(tr('สร้างคำเชิญแล้ว แต่ส่งอีเมลไม่สำเร็จ กรุณากดส่งอีกครั้ง', 'Invitation created, but the notification email failed to send.'));
          }
        }
        await fetchPendingInvitations();
      } else if (result === 'member_added') {
        setInviteResult('member_added');
        setInviteResultMsg(tr('เพิ่มสมาชิกแล้ว', 'Member added successfully.'));
        await fetchMembers();
      } else if (result === 'already_member') {
        setInviteResult('already_member');
        setInviteResultMsg(tr('อีเมลนี้เป็นสมาชิกที่ใช้งานอยู่แล้ว', 'This email is already an active member.'));
      } else if (result === 'already_invited') {
        setInviteResult('already_invited');
        setInviteResultMsg(tr('อีเมลนี้มีคำเชิญอยู่แล้ว', 'An invitation already exists for this email.'));
      }

      setEmail('');
      setRole('queue_staff');
      setInviteEventIds([]);
    } catch (err) {
      console.error('[ManageTeam] invite failed:', err);
      setInviteResult(null);
      setInviteResultMsg(getErrorMessage(err, 'Failed to send invitation.'));
    } finally {
      setAdding(false);
    }
  };

  const handleCancelInvitation = async (inv: PendingInvitation) => {
    if (!confirm(tr(`ยกเลิกคำเชิญของ ${inv.invited_email}? ผู้รับจะตอบรับไม่ได้อีก`, `Cancel invitation for ${inv.invited_email}? They will no longer be able to accept it.`))) return;
    try {
      const { error } = await withTimeout(
        supabase.rpc('cancel_team_invitation', { p_invitation_id: inv.id })
      );
      if (error) throw error;
      await fetchPendingInvitations();
    } catch (err) {
      console.error('[ManageTeam] cancel invitation failed:', err);
      setInviteResult(null);
      setInviteResultMsg(getErrorMessage(err, 'Failed to cancel invitation.'));
    }
  };

  const handleResendInvitation = async (inv: PendingInvitation) => {
    setResendingId(inv.id);
    setResendResultId(null);
    setResendResultOk(null);
    try {
      const { error } = inv.role === 'seller' || inv.role === 'queue_staff'
        ? await withTimeout(
            supabase.auth.signInWithOtp({
              email: inv.invited_email,
              options: {
                emailRedirectTo: getInvitationRedirectUrl(),
              },
            })
          )
        : await withTimeout(
            invokeNotificationFunction('notify-team-invitation', { invitation_id: inv.id })
          );
      setResendResultId(inv.id);
      setResendResultOk(!error);
    } catch {
      setResendResultId(inv.id);
      setResendResultOk(false);
    } finally {
      setResendingId(null);
    }
  };

  const handleUpdateStatus = async (member: TeamMember, nextStatus: 'active' | 'inactive') => {
    if (!isOwner || updatingRoleId) return;
    setUpdatingRoleId(member.id);
    try {
      const { error } = await withTimeout(
        supabase
          .from('artist_members')
          .update({ status: nextStatus })
          .eq('id', member.id)
      );
      if (error) {
        setMemberActionError(error.message || 'Failed to update member status');
        return;
      }
      await fetchMembers();
    } catch (error) {
      setMemberActionError(getErrorMessage(error, 'Failed to update member status'));
    } finally {
      setUpdatingRoleId(null);
    }
  };

  const handleShippingResponsibility = async (member: TeamMember, enabled: boolean) => {
    if (!isOwner || updatingRoleId) return;
    setUpdatingRoleId(member.id);
    try {
      const { error } = await supabase.from('artist_members')
        .update({ can_manage_shipping: enabled }).eq('id', member.id).select('id').single();
      if (error) throw error;
      await fetchMembers();
    } catch (error) {
      setMemberActionError(getErrorMessage(error, language === 'th' ? 'บันทึกสิทธิ์จัดส่งไม่สำเร็จ' : 'Could not update shipping responsibility'));
    } finally {
      setUpdatingRoleId(null);
    }
  };

  const handleUpdateRole = async (member: TeamMember, nextRole: ActorRole) => {
    if (!isOwner || updatingRoleId || member.role === nextRole) return;
    if (!confirm(tr(`เปลี่ยนบทบาทของ ${member.member_email} เป็น ${roleLabel(nextRole)}? ${roleDetail(nextRole)}`, `Change ${member.member_email} to ${roleLabel(nextRole)}? ${roleDetail(nextRole)}`))) return;

    setUpdatingRoleId(member.id);
    try {
      const { data, error } = await withTimeout(
        supabase.rpc('update_artist_member_role', {
          p_member_id: member.id,
          p_next_role: nextRole,
        })
      );

      if (error || !data) {
        throw error || new Error('Failed to update member role');
      }

      await fetchMembers();
    } catch (err) {
      console.error('[ManageTeam] update role failed:', err);
      setMemberActionError(getErrorMessage(err, 'Failed to update member role'));
    } finally {
      setUpdatingRoleId(null);
    }
  };

  const handleDelete = async (member: TeamMember) => {
    if (!confirm(tr(`นำ ${member.member_email} ออกจากทีม? สมาชิกจะเข้าใช้งานร้านนี้ไม่ได้`, `Remove member ${member.member_email}?`))) return;

    try {
      const { error } = await withTimeout(
        supabase.rpc('remove_team_member', { p_member_id: member.id })
      );

      if (error) {
        setMemberActionError(error.message || 'Failed to delete member');
        return;
      }
      await fetchMembers();
    } catch (error) {
      setMemberActionError(getErrorMessage(error, 'Failed to delete member'));
    }
  };

  return (
    <div className="team-workspace min-h-screen bg-gray-50">
      <AdminHeader activePage="team" actorRole={actorContext.role} />
      <main className="max-w-5xl mx-auto px-4 md:px-6 py-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-black text-gray-800">{tr('ทีมและสิทธิ์เข้าถึง', 'Team Access')}</h1>
            <p className="text-sm text-gray-500">{tr('ตรวจหน้าที่ อีเวนต์ที่เข้าถึง และคำเชิญของแต่ละคน', 'Review responsibilities, event access and invitations for each person.')}</p>
          </div>
        </div>

        {Object.values(loadErrors).some(Boolean) && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{tr('โหลดข้อมูลทีมบางส่วนไม่ได้ อย่าอ้างอิงรายการที่ไม่ครบ', 'Some team data could not be loaded. The list may be incomplete.')} <button onClick={() => { void fetchMembers(); void fetchEventsAndAssignments(); void fetchPendingInvitations(); }} className="ml-2 font-bold underline">{tr('ลองใหม่', 'Retry')}</button></div>}
        <details className="mb-5 rounded-xl border border-pink-200 bg-white p-4"><summary className="cursor-pointer font-bold text-pink-800">{tr('แต่ละบทบาททำอะไรได้บ้าง?', 'What can each role do?')}</summary><dl className="mt-3 grid gap-4 sm:grid-cols-2">{(['owner', 'manager', 'seller', 'queue_staff'] as const).map(value => <div key={value}><dt className="font-bold">{roleLabel(value)}</dt><dd className="mt-1 text-sm leading-6 text-slate-600">{roleDetail(value)}</dd></div>)}</dl><p className="mt-4 text-sm text-slate-600">{tr('เจ้าของร้านเท่านั้นที่เปลี่ยนบทบาท สิทธิ์อีเวนต์ และผู้รับผิดชอบจัดส่งได้', 'Only the owner can change roles, event access and shipping responsibility.')}</p></details>
        <Link to="/invitations" className="mb-5 inline-flex min-h-11 items-center font-bold text-pink-800">{tr('ดูคำเชิญที่ฉันได้รับ →', 'My received invitations →')}</Link>
        {/* Invite Member */}
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <UserPlus size={14} className="text-gray-500" />
            <h2 className="text-sm font-bold text-gray-800">{tr('เชิญสมาชิก', 'Invite Member')}</h2>
          </div>
          <form onSubmit={handleInvite} className="px-4 py-4 flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="email"
                aria-label={tr('อีเมลผู้รับคำเชิญ', 'Invitation email')}
                placeholder="staff@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setInviteResult(null); setInviteResultMsg(''); }}
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-pink-200"
                required
              />
              <select aria-label={tr('บทบาทที่เชิญ', 'Invitation role')}
                value={role}
                onChange={(e) => {
                  const nextRole = e.target.value as ActorRole;
                  setRole(nextRole);
                  if (nextRole === 'manager') setInviteEventIds([]);
                }}
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
              >
                {inviteRoleOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{roleLabel(opt.value)}</option>
                ))}
              </select>
              <Button
                type="submit"
                disabled={!canSave || adding || !accessReady}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg disabled:opacity-50"
              >
                {adding ? tr('กำลังส่ง…', 'Sending…') : tr('ส่งคำเชิญ', 'Invite')}
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              {role === 'manager'
                ? tr('ผู้จัดการเข้าถึงทุกอีเวนต์ จัดการสินค้า โปรโมชัน ขาย และคิวได้ เจ้าของร้านเท่านั้นที่เปลี่ยนบทบาทและสิทธิ์อีเวนต์ได้', 'Managers can manage events, catalog, promotions, POS and queues for every event. Only owners can change roles and event access.')
                : tr('พนักงานขายและทีมงานคิวรับลิงก์เข้าสู่ระบบทางอีเมล และเข้าถึงเฉพาะอีเวนต์ที่เลือกด้านล่าง', 'Seller and queue staff receive a magic link and can only access the events selected below.')}
            </p>
            {inviteRequiresEventAccess && (
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-[11px] font-black uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                    <CalendarDays size={12} />
                    {tr('เลือกอีเวนต์ที่เข้าถึงได้', 'Event access required')}
                  </div>
                  <button
                    type="button"
                    onClick={() => setInviteEventIds(events.filter(event => event.status === 'Confirmed').map((event) => event.id))}
                    className="text-[11px] font-black text-pink-600 hover:text-pink-700"
                  >
                    {tr('เลือกทั้งหมดที่แสดง', 'Select all listed')}
                  </button>
                </div>
                {events.filter(event => event.status === 'Confirmed').length === 0 ? (
                  <p className="text-xs font-semibold text-amber-700">{tr('สร้างอีเวนต์ที่ยืนยันแล้วก่อนเชิญทีมงาน', 'Create a confirmed event before inviting event-limited staff.')}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {events.filter(event => event.status === 'Confirmed').map((event) => {
                      const checked = inviteEventIds.includes(event.id);
                      return (
                        <label key={`invite-${event.id}`} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${
                          checked ? 'border-pink-200 bg-pink-50 text-pink-800' : 'border-gray-200 bg-white text-pink-900'
                        }`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleInviteEvent(event.id)}
                          />
                          <span>{event.event_name}</span><span className="text-slate-600">{new Date(event.start_date).toLocaleDateString(th ? 'th-TH' : 'en-GB')}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {inviteEventIds.length === 0 && (
                  <p className="mt-2 text-[11px] font-semibold text-red-500">{tr('เลือกอย่างน้อย 1 อีเวนต์สำหรับบทบาทนี้', 'Select at least one event for this role.')}</p>
                )}
              </div>
            )}
            {inviteResultMsg && (
              <p role="status" className={`text-sm ${
                inviteResult === 'member_added' || inviteResult === 'invitation_sent'
                  ? 'text-green-600'
                  : inviteResult === 'email_failed'
                  ? 'text-blue-600'
                  : 'text-amber-600'
              }`}>
                {inviteResultMsg}
              </p>
            )}
          </form>
        </section>

        {/* Pending Invitations */}
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Clock size={14} className="text-gray-500" />
            <h2 className="text-sm font-bold text-gray-800">{tr('คำเชิญที่รอตอบรับ', 'Pending Invitations')}</h2>
          </div>
          {pendingInvitations.length === 0 ? (
            <p className="px-4 py-5 text-sm text-gray-400">{tr('ไม่มีคำเชิญที่รอตอบรับ', 'No pending invitations.')}</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {pendingInvitations.map((inv) => (
                <div key={inv.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 break-all">{inv.invited_email}</p>
                    <p className="text-xs text-gray-500">
                      {roleLabel(inv.role)} · {tr('เชิญเมื่อ', 'Invited')} {new Date(inv.invited_at).toLocaleDateString(th ? 'th-TH' : 'en-GB')}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-700">{inv.expires_at ? `${new Date(inv.expires_at).getTime() <= Date.now() ? tr('หมดอายุแล้ว', 'Expired') : tr('รอตอบรับ · หมดอายุ', 'Pending · expires')} ${new Date(inv.expires_at).toLocaleString(th ? 'th-TH' : 'en-GB')}` : tr('รอตอบรับ', 'Pending')}{inv.role === 'manager' ? tr(' · ทุกอีเวนต์', ' · All events') : ''}</p>
                    {inv.expires_at && new Date(inv.expires_at).getTime() <= Date.now() && <p className="mt-1 text-xs text-amber-800">{tr('ยกเลิกคำเชิญนี้แล้วเชิญใหม่เพื่อกำหนดสิทธิ์และวันหมดอายุใหม่', 'Cancel this invitation and invite again to renew its access and expiry.')}</p>}
                    {inv.event_ids && inv.event_ids.length > 0 && (
                      <p className="mt-0.5 text-xs text-gray-500">
                        {tr('อีเวนต์:', 'Event access:')} {inv.event_ids.map(getEventName).join(', ')}
                      </p>
                    )}
                    {resendResultId === inv.id && (
                      <p className={`text-xs mt-0.5 ${resendResultOk ? 'text-green-600' : 'text-red-500'}`}>
                        {resendResultOk ? tr('ส่งอีเมลอีกครั้งแล้ว', 'Email resent.') : tr('ส่งอีเมลไม่สำเร็จ', 'Resend failed.')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleResendInvitation(inv)}
                      disabled={!!resendingId || !!(inv.expires_at && new Date(inv.expires_at).getTime() <= Date.now())}
                      className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1"
                    >
                      <Send size={12} />
                      {resendingId === inv.id ? tr('กำลังส่ง…', 'Sending…') : tr('ส่งอีกครั้ง', 'Resend')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancelInvitation(inv)}
                      className="text-xs px-2.5 py-1.5 border border-red-100 rounded-lg text-red-500 hover:bg-red-50 flex items-center gap-1"
                    >
                      <X size={12} />
                      {tr('ยกเลิกคำเชิญ', 'Cancel')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Users size={14} className="text-gray-500" />
            <h2 className="text-sm font-bold text-gray-800">{tr('สมาชิกในร้าน', 'Current Members')}</h2>
          </div>
          <label className="block border-b border-gray-100 p-4"><span className="mb-2 block text-sm font-semibold">{tr('ค้นหาสมาชิกหรือบทบาท', 'Search members or roles')}</span><input className="w-full rounded-lg border border-gray-300 px-3" value={memberSearch} onChange={event => setMemberSearch(event.target.value)} /></label>
          {memberActionError && (
            <div role="alert" className="px-4 py-2 bg-red-50 border-b border-red-100">
              <p className="text-xs text-red-600">{memberActionError}</p>
            </div>
          )}
          {events.length > 6 && (
            <div className="border-b border-gray-100 px-4 py-3">
              <label className="relative block">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                <span className="sr-only">{tr('ค้นหาอีเวนต์', 'Search event access list')}</span>
                <input
                  value={eventAccessSearch}
                  onChange={(event) => setEventAccessSearch(event.target.value)}
                  className="min-h-11 w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-pink-200"
                  placeholder={tr('ค้นหาอีเวนต์…', 'Search events for access chips...')}
                />
              </label>
            </div>
          )}
          {memberSearch && !members.some(member => `${member.member_email} ${roleLabel(member.role)}`.toLowerCase().includes(memberSearch.trim().toLowerCase())) && <p role="status" className="p-4 text-sm text-slate-600">{tr('ไม่พบสมาชิกที่ตรงกับคำค้น', 'No matching members.')}</p>}
          {loading ? (
            <div className="px-4 py-8 text-sm text-gray-500">{tr('กำลังโหลดสมาชิก…', 'Loading members...')}</div>
          ) : members.length === 0 ? (
            <div className="px-4 py-8 text-sm text-gray-500">{tr('ยังไม่มีสมาชิกในทีม', 'No team members yet.')}</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {members.filter(member => `${member.member_email} ${roleLabel(member.role)}`.toLowerCase().includes(memberSearch.trim().toLowerCase())).map((member) => (
                <div key={member.id} className="px-4 py-3 flex flex-col gap-3">
                  <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 break-all">{member.member_email}</p>
                    <p className="text-xs text-gray-500">
                      {tr('เข้าร่วม', 'Joined')} {new Date(member.created_at).toLocaleDateString(th ? 'th-TH' : 'en-GB')} · {roleLabel(member.role)}
                    </p>
                    <p className="mt-2 text-sm text-slate-700">{roleDetail(member.role)}</p>
                    <p className="mt-2 text-sm font-semibold text-pink-800">{member.status === 'inactive' ? tr('ระงับการเข้าถึงร้านอยู่', 'Shop access is inactive') : !accessReady ? tr('กำลังตรวจสิทธิ์อีเวนต์', 'Checking event access') : member.role === 'owner' || member.role === 'manager' || getMemberAssignedEventIds(member.id).size === 0 ? tr('ทุกอีเวนต์ รวมถึงอีเวนต์ใหม่ ตามบทบาท', 'All events, including future events, within this role') : [...getMemberAssignedEventIds(member.id)].map(getEventName).join(' · ')}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wide font-bold text-gray-500 flex items-center gap-1">
                      <Shield size={12} />
                      {tr('บทบาท', 'Role')}
                    </span>
                    <select aria-label={`${tr('บทบาท', 'Role')} ${member.member_email}`}
                      value={member.role}
                      onChange={(e) => handleUpdateRole(member, e.target.value as ActorRole)}
                      className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
                      disabled={!isOwner || member.role === 'owner' || updatingRoleId === member.id}
                    >
                      <option value="owner">{roleLabel('owner')}</option>
                      {ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{roleLabel(option.value)}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!isOwner || member.role === 'owner' || !!updatingRoleId}
                      aria-label={`${member.status === 'active' ? tr('พักสิทธิ์', 'Deactivate') : tr('เปิดสิทธิ์', 'Activate')} ${member.member_email}`}
                      onClick={() => handleUpdateStatus(member, member.status === 'active' ? 'inactive' : 'active')}
                      className={`workspace-action min-h-10 px-3 py-2 rounded-lg text-xs font-bold ${
                        member.status === 'active'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {member.status === 'active' ? tr('ใช้งานอยู่', 'Active') : tr('พักการใช้งาน', 'Inactive')}
                    </button>
                    {member.role !== 'owner' && (isOwner || member.role === 'seller' || member.role === 'queue_staff') && (
                      <button
                        type="button"
                        onClick={() => handleDelete(member)}
                        className="icon-touch inline-flex items-center justify-center rounded-lg text-red-700 hover:text-red-800 hover:bg-red-50"
                        aria-label={`${tr('นำสมาชิกออก', 'Remove')} ${member.member_email}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  </div>

                  {member.role === 'seller' && (
                    <label className="flex min-h-11 items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={member.can_manage_shipping} disabled={!isOwner || updatingRoleId === member.id}
                        onChange={event => void handleShippingResponsibility(member, event.target.checked)} />
                      {language === 'th' ? 'รับผิดชอบจัดส่ง — ดูที่อยู่และช่องทางติดต่อลูกค้า' : 'Shipping responsibility — access customer addresses and contacts'}
                    </label>
                  )}
                  {(member.role === 'seller' || member.role === 'queue_staff') && events.length > 0 && (
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                      <p className="mb-2 text-xs leading-5 text-slate-600">{tr('เปลี่ยนแล้วบันทึกทันที · เอาเครื่องหมายออกทั้งหมดจะเปิดสิทธิ์ทุกอีเวนต์', 'Changes save immediately. Clearing every selection grants access to all events.')}</p>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-[11px] font-black uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                          <CalendarDays size={12} />
                          {tr('อีเวนต์ที่เข้าถึงได้', 'Event access')}
                        </div>
                        <button
                          type="button"
                          disabled={!isOwner || !!savingAssignmentsId || !accessReady}
                          onClick={() => {
                            const assigned = getMemberAssignedEventIds(member.id);
                            const nextIds = assigned.size === events.length ? [] : events.map((event) => event.id);
                            void saveMemberAssignments(member, nextIds);
                          }}
                          className="text-[11px] font-black text-pink-600 hover:text-pink-700 disabled:text-gray-400"
                        >
                          {getMemberAssignedEventIds(member.id).size === events.length ? tr('ยกเลิกข้อจำกัดทั้งหมด', 'Clear restrictions') : tr('เลือกทุกอีเวนต์ที่แสดง', 'Allow all listed')}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {filteredEvents.map((event) => {
                          const assigned = getMemberAssignedEventIds(member.id);
                          const checked = assigned.has(event.id);
                          return (
                            <label key={`${member.id}-${event.id}`} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${
                              checked ? 'border-pink-200 bg-pink-50 text-pink-800' : 'border-gray-200 bg-white text-pink-900'
                            }`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!isOwner || !!savingAssignmentsId || !accessReady}
                                onChange={(changeEvent) => {
                                  const current = getMemberAssignedEventIds(member.id);
                                  const next = new Set(current);
                                  if (changeEvent.target.checked) next.add(event.id);
                                  else next.delete(event.id);
                                  void saveMemberAssignments(member, Array.from(next));
                                }}
                              />
                              <span>{event.event_name}</span><span className="text-slate-600">{new Date(event.start_date).toLocaleDateString(th ? 'th-TH' : 'en-GB')}</span>
                            </label>
                          );
                        })}
                      </div>
                      {getMemberAssignedEventIds(member.id).size === 0 && (
                        <p className="mt-2 text-[11px] font-semibold text-gray-500">{tr('ไม่ได้จำกัดอีเวนต์: เข้าถึงทุกอีเวนต์ตามบทบาท รวมถึงอีเวนต์ใหม่ เลือกรายการเพื่อจำกัดสิทธิ์', 'No restrictions: this staff can access all events for their role, including future events. Select events to restrict access.')}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
