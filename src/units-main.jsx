import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './units.css'
import UnitsApp from './UnitsApp.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <UnitsApp />
  </StrictMode>,
)
