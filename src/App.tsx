// import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// Customer Pages
import CustomerLayout from './pages/customer/CustomerLayout';
import CustomerHome from './pages/customer/Home';
import MenuView from './pages/customer/MenuView';
import QueueView from './pages/customer/QueueView';

// Creator Pages
import ManageProducts from './pages/creators/ManageProducts';
import ManageArtist from './pages/creators/ManageArtist';
import AppSupabase from './AppSupabase';

// Auth & Layout
import Login from './pages/Login';

function App() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="app-container">
        <Routes>
          {/* Login Page */}
          <Route path="/login" element={<Login />} />
          
          {/* Creator Dashboard Routes */}
          <Route path="/manage-queues" element={<AppSupabase />} />
          <Route path="/manage-products" element={<ManageProducts />} />
          <Route path="/manage-events" element={<ManageArtist />} />

          {/* Customer Facing App (Slug-Based) - Primary Entry Point */}
          <Route path="/:slug" element={<CustomerLayout />}>
             <Route path="home" element={<CustomerHome />} />
             <Route path="menu" element={<MenuView />} />
             <Route path="queue" element={<QueueView />} />
             {/* Default: Show home when just slug is entered */}
             <Route index element={<CustomerHome />} />
          </Route>
        </Routes>
      </div>
    </Router>
  );
}

export default App;
