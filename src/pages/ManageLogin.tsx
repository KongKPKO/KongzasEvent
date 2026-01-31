import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { Card, Button } from '../components/ui';
import { KeyRound, Mail, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const ManageLogin = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Check if already logged in
  useEffect(() => {
     supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
           navigate('/manage-events');
        }
     });
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setErrorMsg(error.message);
      setLoading(false);
    } else {
       // Success! Redirect to Events page
       navigate('/manage-events');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-green-600 tracking-wider uppercase mb-2">Queue Manager</h1>
          <p className="text-gray-500 font-medium">Supabase Portal</p>
        </div>

        <Card className="p-8 shadow-xl border-gray-100 bg-white">
          <h2 className="text-xl font-bold mb-6 text-gray-800 flex items-center gap-2">
            <KeyRound className="text-green-600" />
            Creator Login
          </h2>

          {errorMsg && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-6 flex items-start gap-2 text-sm font-medium border border-red-100 animate-fade-in">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-600 focus:border-transparent outline-none transition-all"
                  placeholder="artist@example.com"
                  required
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Password</label>
              <div className="relative">
                 <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-600 focus:border-transparent outline-none transition-all"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 mt-4"
              disabled={loading}
            >
              {loading ? 'Authenticating...' : 'Login to Dashboard'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
};

export default ManageLogin;
