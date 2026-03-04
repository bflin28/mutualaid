import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useAuth } from './contexts/AuthContext'
import { AppShell } from './components/layout/AppShell'
import { FoodLogForm } from './components/food-log/FoodLogForm'
import { StatsDashboard } from './components/statistics/StatsDashboard'
import { SignupPage } from './components/signup/SignupPage'
import { MapPage } from './components/map/MapPage'
import { AdminPage } from './components/admin/AdminPage'
import { LoginPage } from './components/auth/LoginPage'
import { ResetPasswordPage } from './components/auth/ResetPasswordPage'

export default function App() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  if (!user) {
    return (
      <BrowserRouter>
        <Toaster position="top-right" />
        <Routes>
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="*" element={<LoginPage />} />
        </Routes>
      </BrowserRouter>
    )
  }

  return (
    <BrowserRouter>
      <Toaster position="top-right" />
      <AppShell>
        <Routes>
          <Route path="/" element={<StatsDashboard />} />
          <Route path="/log" element={<FoodLogForm />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  )
}
