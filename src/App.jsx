import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AppShell } from './components/layout/AppShell'
import { FoodLogForm } from './components/food-log/FoodLogForm'
import { StatsDashboard } from './components/statistics/StatsDashboard'
import { SignupPage } from './components/signup/SignupPage'
import { MapPage } from './components/map/MapPage'
import { AdminPage } from './components/admin/AdminPage'

export default function App() {
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
        </Routes>
      </AppShell>
    </BrowserRouter>
  )
}
