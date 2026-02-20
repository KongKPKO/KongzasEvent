import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import AdminHeader from '../../components/AdminHeader';
import { Button } from '../../components/ui';
import type { ActorContext, ActorRole } from '../../types/access';
import { UserPlus, Users, Shield, Trash2, RefreshCcw } from 'lucide-react';

interface TeamMember {
  id: string;
  member_email: string;
  role: ActorRole;
  status: 'active' | 'inactive';
  created_at: string;
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

export default function ManageTeam({ actorContext }: ManageTeamProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ActorRole>('queue_only');

  const canSave = useMemo(() => email.trim().length > 3, [email]);

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

  useEffect(() => {
    fetchMembers();
  }, [actorContext.artist_id]);

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
      setRole('queue_only');
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
          <form onSubmit={handleAddMember} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@email.com"
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
              required
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as ActorRole)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pink-500"
            >
              <option value="queue_only">Queue only</option>
              <option value="queue_pos">Queue + POS</option>
            </select>
            <Button
              type="submit"
              disabled={!canSave || adding}
              className="bg-pink-600 hover:bg-pink-700 text-white py-2 rounded-lg text-sm font-bold disabled:bg-pink-300"
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
          {loading ? (
            <div className="px-4 py-8 text-sm text-gray-500">Loading members...</div>
          ) : members.length === 0 ? (
            <div className="px-4 py-8 text-sm text-gray-500">No team members yet.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {members.map((member) => (
                <div key={member.id} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{member.member_email}</p>
                    <p className="text-xs text-gray-500">
                      Joined {new Date(member.created_at).toLocaleDateString('en-GB')}
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
                      <option value="queue_only">Queue only</option>
                      <option value="queue_pos">Queue + POS</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleUpdateStatus(member, member.status === 'active' ? 'inactive' : 'active')}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-bold ${
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
                        className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
