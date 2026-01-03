import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './review.css'
import ReviewApp from './ReviewApp.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ReviewApp />
  </StrictMode>,
)
