import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import AdminHeader from '../../components/AdminHeader';
import { Button } from '../../components/ui';
import type { ActorContext, ActorRole } from '../../types/access';
import { CalendarDays, UserPlus, Users, Shield, Trash2, RefreshCcw, Search, Clock, Send, X } from 'lucide-react';

interface TeamMember {
  id: string;
  member_email: string;
  role: ActorRole;
  status: 'active' | 'inactive';
  created_at: string;
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
  { value: 'manager', label: 'Manager', detail: 'Events, menu, catalog, dashboard, queue, and POS. No team access.' },
  { value: 'seller', label: 'Seller / POS Staff', detail: 'Queue plus checkout and payment for assigned events.' },
  { value: 'queue_staff', label: 'Queue Staff', detail: 'Queue calling and booth flow only. No checkout.' },
];

const getRoleLabel = (role: ActorRole) => {
  if (role === 'owner') return 'Owner';
  return ROLE_OPTIONS.find((option) => option.value === role)?.label || role;
};

export default function ManageTeam({ actorContext }: ManageTeamProps) {
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
          .select('id, member_email, role, status, created_at')
          .eq('artist_id', actorContext.artist_id)
          .order('created_at', { ascending: true })
      );

      if (error) {
        console.error('[ManageTeam] fetch members failed:', error);
      } else {
        setMembers((data || []) as TeamMember[]);
      }
    } catch (error) {
      console.error('[ManageTeam] fetch members request failed:', error);
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
            .eq('status', 'Confirmed')
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
      setEvents((eventData || []) as TeamEvent[]);
      setAssignments((assignmentData || []) as EventAssignment[]);
    } catch (error) {
      console.error('[ManageTeam] fetch events/assignments failed:', error);
    }
  };

  const fetchPendingInvitations = async () => {
    try {
      const { data, error } = await withTimeout(
        supabase.rpc('list_team_invitations', { p_artist_id: actorContext.artist_id })
      );
      if (!error) setPendingInvitations((data || []) as PendingInvitation[]);
    } catch (err) {
      console.error('[ManageTeam] fetch pending invitations failed:', err);
    }
  };

  useEffect(() => {
    fetchMembers();
    fetchEventsAndAssignments();
    fetchPendingInvitations();
  }, [actorContext.artist_id]);

  const getMemberAssignedEventIds = (memberId: string) =>
    new Set(assignments.filter((assignment) => assignment.member_id === memberId).map((assignment) => assignment.event_id));

  const getEventName = (eventId: string) => events.find((event) => event.id === eventId)?.event_name || 'Event';

  const getInvitationRedirectUrl = () => `${window.location.origin}/invitations`;

  const toggleInviteEvent = (eventId: string) => {
    setInviteEventIds((current) =>
      current.includes(eventId)
        ? current.filter((id) => id !== eventId)
        : [...current, eventId]
    );
  };

  const saveMemberAssignments = async (member: TeamMember, nextEventIds: string[]) => {
    setSavingAssignmentsId(member.id);
    try {
      const { error: deleteError } = await withTimeout(
        supabase
          .from('event_member_assignments')
          .delete()
          .eq('member_id', member.id)
      );
      if (deleteError) throw deleteError;

      if (nextEventIds.length > 0) {
        const { error: insertError } = await withTimeout(
          supabase.from('event_member_assignments').insert(nextEventIds.map((eventId) => ({
            artist_id: actorContext.artist_id,
            member_id: member.id,
            event_id: eventId,
          })))
        );
        if (insertError) throw insertError;
      }

      await fetchEventsAndAssignments();
    } catch (error) {
      setMemberActionError(getErrorMessage(error, 'Failed to save event access'));
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
            setInviteResultMsg('Invitation created, but the magic link email failed to send. Use Resend after checking auth email settings.');
          } else {
            setInviteResult('invitation_sent');
            setInviteResultMsg('Magic link sent. Staff can open the email, accept the invite, and work only the selected event access.');
          }
        } else {
          try {
            const { error: notifyError } = await withTimeout(
              supabase.functions.invoke('notify-team-invitation', {
                body: { invitation_id: invitationId },
              })
            );
            if (notifyError) {
              setInviteResult('email_failed');
              setInviteResultMsg('Invitation created, but the notification email failed to send.');
            } else {
              setInviteResult('invitation_sent');
              setInviteResultMsg('Manager invitation sent. They can create a password staff account without a creator profile.');
            }
          } catch {
            setInviteResult('email_failed');
            setInviteResultMsg('Invitation created, but the notification email failed to send.');
          }
        }
        await fetchPendingInvitations();
      } else if (result === 'member_added') {
        setInviteResult('member_added');
        setInviteResultMsg('Member added successfully.');
        await fetchMembers();
      } else if (result === 'already_member') {
        setInviteResult('already_member');
        setInviteResultMsg('This email is already an active member.');
      } else if (result === 'already_invited') {
        setInviteResult('already_invited');
        setInviteResultMsg('An invitation already exists for this email.');
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
    if (!confirm(`Cancel invitation for ${inv.invited_email}? They will no longer be able to accept it.`)) return;
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
            supabase.functions.invoke('notify-team-invitation', {
              body: { invitation_id: inv.id },
            })
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
    }
  };

  const handleUpdateRole = async (member: TeamMember, nextRole: ActorRole) => {
    if (member.role === nextRole) return;

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
    if (!confirm(`Remove member ${member.member_email}?`)) return;

    try {
      const { error } = await withTimeout(
        supabase
          .from('artist_members')
          .delete()
          .eq('id', member.id)
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
    <div className="min-h-screen bg-gray-50">
      <AdminHeader activePage="team" actorRole={actorContext.role} />
      <main className="max-w-5xl mx-auto px-4 md:px-6 py-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-black text-gray-800">Team Access</h1>
            <p className="text-sm text-gray-500">Manage queue roles for your booth team.</p>
          </div>
          <Button
            type="button"
            onClick={fetchMembers}
            className="text-xs px-3 py-2 border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 rounded-lg flex items-center gap-1.5"
          >
            <RefreshCcw size={14} />
            Refresh
          </Button>
        </div>

        {/* Invite Member */}
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <UserPlus size={14} className="text-gray-500" />
            <h2 className="text-sm font-bold text-gray-800">Invite Member</h2>
          </div>
          <form onSubmit={handleInvite} className="px-4 py-4 flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="email"
                placeholder="staff@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setInviteResult(null); setInviteResultMsg(''); }}
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-pink-200"
                required
              />
              <select
                value={role}
                onChange={(e) => {
                  const nextRole = e.target.value as ActorRole;
                  setRole(nextRole);
                  if (nextRole === 'manager') setInviteEventIds([]);
                }}
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <Button
                type="submit"
                disabled={!canSave || adding}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg disabled:opacity-50"
              >
                {adding ? 'Sending…' : 'Invite'}
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              {role === 'manager'
                ? 'Managers use a password staff account and can manage events, catalog, promotions, POS, and queue for every event. Team access stays owner-only.'
                : 'Seller and queue staff receive a magic link and can only access the events selected below.'}
            </p>
            {inviteRequiresEventAccess && (
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-[11px] font-black uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                    <CalendarDays size={12} />
                    Event access required
                  </div>
                  <button
                    type="button"
                    onClick={() => setInviteEventIds(events.map((event) => event.id))}
                    className="text-[11px] font-black text-pink-600 hover:text-pink-700"
                  >
                    Select all listed
                  </button>
                </div>
                {events.length === 0 ? (
                  <p className="text-xs font-semibold text-amber-700">Create a confirmed event before inviting event-limited staff.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {events.map((event) => {
                      const checked = inviteEventIds.includes(event.id);
                      return (
                        <label key={`invite-${event.id}`} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${
                          checked ? 'border-pink-200 bg-pink-50 text-pink-700' : 'border-gray-200 bg-white text-gray-600'
                        }`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleInviteEvent(event.id)}
                          />
                          {event.event_name}
                        </label>
                      );
                    })}
                  </div>
                )}
                {inviteEventIds.length === 0 && (
                  <p className="mt-2 text-[11px] font-semibold text-red-500">Select at least one event for this role.</p>
                )}
              </div>
            )}
            {inviteResultMsg && (
              <p className={`text-xs ${
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
            <h2 className="text-sm font-bold text-gray-800">Pending Invitations</h2>
          </div>
          {pendingInvitations.length === 0 ? (
            <p className="px-4 py-5 text-sm text-gray-400">No pending invitations.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {pendingInvitations.map((inv) => (
                <div key={inv.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{inv.invited_email}</p>
                    <p className="text-xs text-gray-500">
                      {getRoleLabel(inv.role)} · Invited {new Date(inv.invited_at).toLocaleDateString('en-GB')}
                    </p>
                    {inv.event_ids && inv.event_ids.length > 0 && (
                      <p className="mt-0.5 text-xs text-gray-500">
                        Event access: {inv.event_ids.map(getEventName).join(', ')}
                      </p>
                    )}
                    {resendResultId === inv.id && (
                      <p className={`text-xs mt-0.5 ${resendResultOk ? 'text-green-600' : 'text-red-500'}`}>
                        {resendResultOk ? 'Email resent.' : 'Resend failed.'}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleResendInvitation(inv)}
                      disabled={resendingId === inv.id}
                      className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1"
                    >
                      <Send size={12} />
                      {resendingId === inv.id ? 'Sending…' : 'Resend'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancelInvitation(inv)}
                      className="text-xs px-2.5 py-1.5 border border-red-100 rounded-lg text-red-500 hover:bg-red-50 flex items-center gap-1"
                    >
                      <X size={12} />
                      Cancel
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
            <h2 className="text-sm font-bold text-gray-800">Current Members</h2>
          </div>
          {memberActionError && (
            <div className="px-4 py-2 bg-red-50 border-b border-red-100 cursor-pointer hover:bg-red-100" onClick={() => setMemberActionError('')}>
              <p className="text-xs text-red-600">{memberActionError}</p>
            </div>
          )}
          {events.length > 6 && (
            <div className="border-b border-gray-100 px-4 py-3">
              <label className="relative block">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                <span className="sr-only">Search event access list</span>
                <input
                  value={eventAccessSearch}
                  onChange={(event) => setEventAccessSearch(event.target.value)}
                  className="min-h-11 w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-pink-200"
                  placeholder="Search events for access chips..."
                />
              </label>
            </div>
          )}
          {loading ? (
            <div className="px-4 py-8 text-sm text-gray-500">Loading members...</div>
          ) : members.length === 0 ? (
            <div className="px-4 py-8 text-sm text-gray-500">No team members yet.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {members.map((member) => (
                <div key={member.id} className="px-4 py-3 flex flex-col gap-3">
                  <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{member.member_email}</p>
                    <p className="text-xs text-gray-500">
                      Joined {new Date(member.created_at).toLocaleDateString('en-GB')} · {getRoleLabel(member.role)} · {getMemberAssignedEventIds(member.id).size || 'All'} event access
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wide font-bold text-gray-500 flex items-center gap-1">
                      <Shield size={12} />
                      Role
                    </span>
                    <select
                      value={member.role}
                      onChange={(e) => handleUpdateRole(member, e.target.value as ActorRole)}
                      className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
                      disabled={member.role === 'owner' || updatingRoleId === member.id}
                    >
                      <option value="owner">Owner</option>
                      {ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleUpdateStatus(member, member.status === 'active' ? 'inactive' : 'active')}
                      className={`workspace-action min-h-10 px-3 py-2 rounded-lg text-xs font-bold ${
                        member.status === 'active'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {member.status === 'active' ? 'Active' : 'Inactive'}
                    </button>
                    {member.role !== 'owner' && (
                      <button
                        type="button"
                        onClick={() => handleDelete(member)}
                        className="icon-touch inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
                        aria-label={`Remove ${member.member_email}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  </div>

                  {(member.role === 'seller' || member.role === 'queue_staff') && events.length > 0 && (
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-[11px] font-black uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                          <CalendarDays size={12} />
                          Event access
                        </div>
                        <button
                          type="button"
                          disabled={savingAssignmentsId === member.id}
                          onClick={() => {
                            const assigned = getMemberAssignedEventIds(member.id);
                            const nextIds = assigned.size === events.length ? [] : events.map((event) => event.id);
                            void saveMemberAssignments(member, nextIds);
                          }}
                          className="text-[11px] font-black text-pink-600 hover:text-pink-700 disabled:text-gray-400"
                        >
                          {getMemberAssignedEventIds(member.id).size === events.length ? 'Clear restrictions' : 'Allow all listed'}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {filteredEvents.map((event) => {
                          const assigned = getMemberAssignedEventIds(member.id);
                          const checked = assigned.has(event.id);
                          return (
                            <label key={`${member.id}-${event.id}`} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${
                              checked ? 'border-pink-200 bg-pink-50 text-pink-700' : 'border-gray-200 bg-white text-gray-600'
                            }`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={savingAssignmentsId === member.id}
                                onChange={(changeEvent) => {
                                  const current = getMemberAssignedEventIds(member.id);
                                  const next = new Set(current);
                                  if (changeEvent.target.checked) next.add(event.id);
                                  else next.delete(event.id);
                                  void saveMemberAssignments(member, Array.from(next));
                                }}
                              />
                              {event.event_name}
                            </label>
                          );
                        })}
                      </div>
                      {getMemberAssignedEventIds(member.id).size === 0 && (
                        <p className="mt-2 text-[11px] font-semibold text-gray-500">No restrictions: this staff can access all active events for their role.</p>
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
