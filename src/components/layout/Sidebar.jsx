import { NavLink } from 'react-router-dom'
import { FileText, BarChart3, UserPlus, Map } from 'lucide-react'

const NAV_ITEMS = [
  { to: '/', icon: BarChart3, label: 'Statistics' },
  { to: '/log', icon: FileText, label: 'Log Rescue' },
  { to: '/map', icon: Map, label: 'Map' },
  { to: '/signup', icon: UserPlus, label: 'Food Rescue Signup' },
]

export function Sidebar() {
  return (
    <aside className="hidden md:flex w-64 bg-white border-r border-gray-200 flex-col">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <img src="/favicon.png" alt="CFSC" className="w-10 h-10" />
          <div>
            <h1 className="text-gray-900 font-semibold leading-tight">Chicago Food</h1>
            <h1 className="text-gray-900 font-semibold leading-tight">Sovereignty</h1>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
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
      </nav>

      <div className="p-4 border-t border-gray-200">
        <p className="text-xs text-gray-400 text-center">CFSC Mutual Aid</p>
      </div>
    </aside>
  )
}
