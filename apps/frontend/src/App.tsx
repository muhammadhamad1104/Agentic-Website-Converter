import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './store/authStore';

// Public Views
import Landing from './views/public/Landing/Landing';

// Auth Views
import Login from './views/auth/Login/Login';
import Register from './views/auth/Register/Register';
import ForgotPassword from './views/auth/ForgotPassword/ForgotPassword';
import ResetPassword from './views/auth/ResetPassword/ResetPassword';

import './styles/Auth.css';

// Components
import NotFound from './views/components/NotFound/NotFound';
import Dashboard from './views/dashboard/Dashboard/Dashboard';
import Wizard from './views/dashboard/Wizard/Wizard';
import SitePortal from './views/portal/SitePortal/SitePortal';
import AdminDashboard from './views/admin/AdminDashboard/AdminDashboard';
import Profile from './views/dashboard/Profile/Profile';
import Checkout from './views/dashboard/Checkout/Checkout';

// Security Guard
import ProtectedRoute from './views/components/ProtectedRoute/ProtectedRoute';

export default function App() {
  const fetchMe = useAuthStore((state) => state.fetchMe);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  return (
    <BrowserRouter>
      {/* Toast notifications container */}
      <Toaster
        position="top-right"
        containerStyle={{
          zIndex: 999999,
        }}
        toastOptions={{
          className: 'glass-toast',
          style: {
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--glass-border)',
            backdropFilter: 'blur(12px)',
          },
          success: {
            iconTheme: {
              primary: '#818cf8',
              secondary: 'white',
            },
          },
        }}
      />

      <Routes>
        {/* Public routes */}
        <Route path="/" element={<Landing />} />
        
        {/* Auth routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* Dashboard & App routes (Protected) */}
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        <Route path="/checkout" element={<ProtectedRoute><Checkout /></ProtectedRoute>} />
        <Route path="/wizard" element={<ProtectedRoute><Wizard /></ProtectedRoute>} />
        <Route path="/sites/:id" element={<ProtectedRoute><SitePortal /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute requireAdmin><AdminDashboard /></ProtectedRoute>} />

        {/* 404 Fallback */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
