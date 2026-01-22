// import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// Pages
// Pages
import Home from './pages/customer/Home';
import Admin from './pages/Admin';
import Queue from './pages/Queue';
import Menu from './pages/Menu';
import Login from './pages/Login';
import MainLayout from './components/MainLayout';
import { RequireAuth } from './components/RequireAuth';
import AppSupabase from './AppSupabase';

// Customer Pages
import CustomerLayout from './pages/customer/CustomerLayout';
import CustomerHome from './pages/customer/Home';
import MenuView from './pages/customer/MenuView';
import QueueView from './pages/customer/QueueView';
import ManageProducts from './pages/ManageProducts';
import ManageArtist from './pages/artist/ManageArtist';

function App() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="app-container">
        <Routes>
          <Route element={<MainLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/menu" element={<Menu />} />
            <Route path="/queue" element={<Queue />} />
            
            {/* Protected Admin Routes - now inside MainLayout for uniform nav */}
            <Route element={<RequireAuth />}>
               <Route path="/admin" element={<Admin />} />
            </Route>
          </Route>

          {/* Login Page */}
          <Route path="/login" element={<Login />} />
          
          {/* Supabase Demo Integration */}
          <Route path="/supabase-demo" element={<AppSupabase />} />
          <Route path="/manage-products" element={<ManageProducts />} />
          <Route path="/artist/manage" element={<ManageArtist />} />

          {/* Customer Facing App (Slug-Based) */}
          <Route path="/:slug" element={<CustomerLayout />}>
             <Route path="home" element={<CustomerHome />} />
             <Route path="menu" element={<MenuView />} />
             <Route path="queue" element={<QueueView />} />
             {/* Default redirect to home if just slug is entered? Or maybe show home */}
             <Route index element={<CustomerHome />} />
          </Route>
        </Routes>
      </div>
    </Router>
  );
}

export default App;
