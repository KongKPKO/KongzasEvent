import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import AdminHeader from '../../components/AdminHeader';
import { Button } from '../../components/ui';
import type { ActorContext, ActorRole } from '../../types/access';
import { CalendarDays, UserPlus, Users, Shield, Trash2, RefreshCcw, Search } from 'lucide-react';

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
  const [eventAccessSearch, setEventAccessSearch] = useState('');

  const canSave = useMemo(() => email.trim().length > 3, [email]);
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

  useEffect(() => {
    fetchMembers();
    fetchEventsAndAssignments();
  }, [actorContext.artist_id]);

  const getMemberAssignedEventIds = (memberId: string) =>
    new Set(assignments.filter((assignment) => assignment.member_id === memberId).map((assignment) => assignment.event_id));

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
      alert(getErrorMessage(error, 'Failed to save event access'));
    } finally {
      setSavingAssignmentsId(null);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || adding) return;

    setAdding(true);
    const normalizedEmail = email.trim().toLowerCase();

    try {
      const { data: userExists, error: userExistsError } = await withTimeout(
        supabase.rpc('auth_user_exists_by_email', {
          p_email: normalizedEmail,
        })
      );

      if (userExistsError) {
        throw userExistsError;
      }

      if (!userExists) {
        alert('This email is not found in Authentication users yet. Please create the Auth user first.');
        return;
      }

      const { data: userData, error: userError } = await withTimeout(supabase.auth.getUser());
      if (userError) {
        console.warn('[ManageTeam] getUser failed:', userError);
      }

      const { error } = await withTimeout(
        supabase.from('artist_members').insert({
          artist_id: actorContext.artist_id,
          member_email: normalizedEmail,
          role,
          status: 'active',
          created_by: userData.user?.id || null,
        })
      );

      if (error) {
        if (error.code === '23505') {
          const { error: updateError } = await withTimeout(
            supabase
              .from('artist_members')
              .update({ role, status: 'active' })
              .eq('artist_id', actorContext.artist_id)
              .eq('member_email', normalizedEmail)
          );

          if (updateError) {
            throw updateError;
          }
        } else {
          throw error;
        }
      }

      setEmail('');
      setRole('queue_staff');
      await fetchMembers();
    } catch (err) {
      console.error('[ManageTeam] add member failed:', err);
      const message = getErrorMessage(err, 'Failed to add member');
      alert(message);
    } finally {
      setAdding(false);
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
        alert(error.message || 'Failed to update member status');
        return;
      }
      await fetchMembers();
    } catch (error) {
      alert(getErrorMessage(error, 'Failed to update member status'));
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
      alert(getErrorMessage(err, 'Failed to update member role'));
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
        alert(error.message || 'Failed to delete member');
        return;
      }
      await fetchMembers();
    } catch (error) {
      alert(getErrorMessage(error, 'Failed to delete member'));
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

        <section className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
          <h2 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
            <UserPlus size={14} />
            Add Team Member
          </h2>
          <p className="mb-3 rounded-xl border border-pink-100 bg-pink-50 px-3 py-2 text-xs font-semibold text-pink-800">
            Add the email your staff will use to sign in. Managers can help run setup and sales, sellers can checkout orders, and queue staff can manage queue flow.
          </p>
          <form onSubmit={handleAddMember} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="text-xs font-black uppercase tracking-wide text-gray-500">Staff email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@email.com"
                className="min-h-11 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                required
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-black uppercase tracking-wide text-gray-500">Role</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as ActorRole)}
                className="min-h-11 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pink-500"
              >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
              </select>
              <p className="text-[11px] font-semibold text-gray-500">
                {ROLE_OPTIONS.find((option) => option.value === role)?.detail}
              </p>
            </label>
            <Button
              type="submit"
              disabled={!canSave || adding}
              className="self-end bg-pink-600 hover:bg-pink-700 text-white py-2 rounded-lg text-sm font-bold disabled:bg-pink-300 min-h-11"
            >
              {adding ? 'Adding...' : 'Add Member'}
            </Button>
          </form>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Users size={14} className="text-gray-500" />
            <h2 className="text-sm font-bold text-gray-800">Current Members</h2>
          </div>
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

                  {member.role !== 'owner' && events.length > 0 && (
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
