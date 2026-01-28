import { useState, useEffect } from 'react'; // ✅ เพิ่ม 1. Import Hook
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './supabaseClient'; // ✅ เพิ่ม 2. Import Supabase (เช็ค path ให้ถูกนะครับ)

// Customer Pages
import CustomerLayout from './pages/customer/CustomerLayout';
import CustomerHome from './pages/customer/Home';
import MenuView from './pages/customer/MenuView';
import QueueView from './pages/customer/QueueView';

// Creator Pages
import ManageProducts from './pages/creators/ManageProducts';
import ManageArtist from './pages/creators/ManageArtist';
import ManageQueue from './pages/creators/SupabaseDashboard';
import ManageOrders from './pages/creators/ManageOrders';
import OrderHistory from './pages/creators/OrderHistory';
import ManageCombined from './pages/ManageCombined';

// Auth & Layout
import Login from './pages/Login';
import ManageLogin from './pages/ManageLogin';

function App() {
  // ✅ เพิ่ม 3. State สำหรับเก็บสถานะ Login
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // ✅ เพิ่ม 4. useEffect เช็คว่าใคร Login อยู่ไหม
  useEffect(() => {
    // เช็คตอนโหลดครั้งแรก
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // ฟังเสียงการเปลี่ยนแปลง (Login/Logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // ถ้ากำลังโหลดข้อมูล User อย่าเพิ่งโชว์อะไร (กันหน้าเว็บกระพริบ)
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>; 
  }

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="app-container">
        <Routes>
          {/* Login Page */}
          <Route path="/login" element={<Login />} />
          <Route path="/manage-login" element={<ManageLogin />} />
          
          {/* Creator Dashboard Routes (✅ เพิ่ม 5. ใส่ตัวล็อคประตู!) */}
          <Route 
            path="/manage-queues" 
            element={session ? <ManageQueue /> : <Navigate to="/manage-login" replace />} 
          />
          <Route 
            path="/manage-products" 
            element={session ? <ManageProducts /> : <Navigate to="/manage-login" replace />} 
          />
          <Route 
            path="/manage-events" 
            element={session ? <ManageArtist /> : <Navigate to="/manage-login" replace />} 
          />
          <Route 
            path="/manage-events/:eventId/history" 
            element={<OrderHistory />} 
          />
          <Route 
            path="/manage-orders" 
            element={session ? <ManageOrders /> : <Navigate to="/manage-login" replace />} 
          />
          <Route 
            path="/manage-pos-queues" 
            element={session ? <ManageCombined /> : <Navigate to="/manage-login" replace />} 
          />
      

          {/* Root Redirect */}
          <Route path="/" element={<Navigate to="/manage-login" replace />} />

          {/* Customer Facing App */}
          <Route path="/:slug" element={<CustomerLayout />}>
             <Route path="home" element={<CustomerHome />} />
             <Route path="menu" element={<MenuView />} />
             <Route path="queue" element={<QueueView />} />
             <Route index element={<CustomerHome />} />
          </Route>
        </Routes>
      </div>
    </Router>
  );
}

export default App;