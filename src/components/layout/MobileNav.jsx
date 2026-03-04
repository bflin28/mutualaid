import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { FileText, BarChart3, UserPlus, Map, Menu, X, LogOut } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

const NAV_ITEMS = [
  { to: '/', icon: BarChart3, label: 'Statistics' },
  { to: '/log', icon: FileText, label: 'Log Rescue' },
  { to: '/map', icon: Map, label: 'Map' },
  { to: '/signup', icon: UserPlus, label: 'Food Rescue Signup' },
]

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const { user, signOut } = useAuth()

  return (
    <div className="md:hidden">
      <div className="flex items-center justify-between p-4 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2">
          <img src="/favicon.png" alt="CFSC" className="w-8 h-8" />
          <span className="font-semibold text-gray-900">CFSC</span>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="p-2 text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100"
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {open && (
        <div className="bg-white border-b border-gray-200 p-4 space-y-1">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              <span className="font-medium">{label}</span>
            </NavLink>
          ))}

          <button
            onClick={() => { signOut(); setOpen(false) }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-gray-500
              hover:bg-gray-50 hover:text-gray-900 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">Sign out</span>
          </button>
          <p className="text-xs text-gray-400 text-center pt-2 truncate">{user?.email}</p>
        </div>
      )}
    </div>
  )
}
