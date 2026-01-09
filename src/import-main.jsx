import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './import.css'
import ImportApp from './ImportApp.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ImportApp />
  </StrictMode>,
)
