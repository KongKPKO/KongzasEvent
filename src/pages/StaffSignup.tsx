import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, KeyRound, Mail, UserPlus } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { Button, Card } from '../components/ui';

export default function StaffSignup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const workspaceName = searchParams.get('workspace')?.trim() || '';
  const [email, setEmail] = useState(searchParams.get('email')?.trim().toLowerCase() || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const canSubmit = email.trim().length > 3 && password.length >= 8 && password === confirmPassword;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg('');
    setMessage('');

    if (!canSubmit) {
      setErrorMsg('Use the invited email and a matching password with at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/invitations`,
        },
      });

      if (error) throw error;

      if (data.session) {
        navigate('/invitations', { replace: true });
      } else {
        setMessage('Account created. Check your email, confirm the account, then accept the invitation.');
      }
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Could not create team account.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link to="/manage-login" className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-gray-900">
          <ArrowLeft size={16} />
          Back to sign in
        </Link>

        <Card className="border-gray-100 bg-white p-8 shadow-xl">
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-pink-50 text-pink-600">
            <UserPlus size={24} />
          </div>
          <h1 className="text-2xl font-black text-gray-900">Create Team Account</h1>
          {workspaceName ? (
            <p className="mt-2 text-sm leading-6 text-gray-500">
              You've received a team invitation to join <span className="font-bold text-gray-800">{workspaceName}</span>. Create a team account with this email to accept the workspace invitation.
            </p>
          ) : (
            <p className="mt-2 text-sm leading-6 text-gray-500">
              This account is only for accepting a team invitation. It will not create a creator profile or public booth page.
            </p>
          )}

          {errorMsg && (
            <div className="mt-5 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-sm font-semibold text-red-700">
              <AlertCircle size={17} className="mt-0.5 shrink-0" />
              {errorMsg}
            </div>
          )}

          {message && (
            <div className="mt-5 flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
              <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="staff-email" className="mb-1 block text-sm font-bold text-gray-700">Invited email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  id="staff-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 py-2 pl-10 pr-4 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-pink-500"
                  placeholder="staff@example.com"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="staff-password" className="mb-1 block text-sm font-bold text-gray-700">Password</label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  id="staff-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 py-2 pl-10 pr-4 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-pink-500"
                  placeholder="At least 8 characters"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="staff-confirm-password" className="mb-1 block text-sm font-bold text-gray-700">Confirm password</label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  id="staff-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 py-2 pl-10 pr-4 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-pink-500"
                  placeholder="Repeat password"
                  required
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={!canSubmit || loading}
              className="mt-2 w-full bg-pink-600 py-3 font-bold text-white hover:bg-pink-700 disabled:opacity-50"
            >
              {loading ? 'Creating account…' : 'Create team account'}
            </Button>
          </form>
          <Link to="/manage-login" className="mt-4 block text-center text-sm font-bold text-pink-600 hover:text-pink-700">
            Already have an account? Sign in
          </Link>
        </Card>
      </div>
    </div>
  );
}
