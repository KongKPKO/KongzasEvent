import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { Card, Button } from '../components/ui';
import { KeyRound, Mail, AlertCircle } from 'lucide-react';

const Login = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Success! Redirect to Admin
      navigate('/admin');
    } catch (err: any) {
      console.error("Login failed", err);
      if (err.code === 'auth/invalid-credential') {
        setError("Invalid email or password.");
      } else if (err.code === 'auth/too-many-requests') {
         setError("Too many attempts. Try again later.");
      } else {
        setError("Failed to login. Please check your connection.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-[#0070C0] tracking-wider uppercase mb-2">Kongzas</h1>
          <p className="text-gray-500 font-medium">Admin Access Portal</p>
        </div>

        <Card className="p-8 shadow-xl border-gray-100 bg-white">
          <h2 className="text-xl font-bold mb-6 text-gray-800 flex items-center gap-2">
            <KeyRound className="text-[#0070C0]" />
            Sign In
          </h2>

          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-6 flex items-start gap-2 text-sm font-medium border border-red-100 animate-fade-in">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              {error}
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
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0070C0] focus:border-transparent outline-none transition-all"
                  placeholder="admin@example.com"
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
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0070C0] focus:border-transparent outline-none transition-all"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full bg-[#0070C0] hover:bg-[#005a9e] text-white font-bold py-3 mt-4"
              disabled={loading}
            >
              {loading ? 'Authenticating...' : 'Login to Dashboard'}
            </Button>
          </form>
        </Card>
        
        <p className="text-center text-gray-400 text-xs mt-8">
          Authorized personnel only. <br/>All access attempts are logged.
        </p>
      </div>
    </div>
  );
};

export default Login;
