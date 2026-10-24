import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import RegionTool from './RegionTool'
import { startupLog } from './startup'

startupLog('main.tsx evaluated: static imports loaded; rendering React')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(location.search).has('regionRole') ? <RegionTool role={new URLSearchParams(location.search).get('regionRole')!} token={new URLSearchParams(location.search).get('token')!} /> : <App />}
  </StrictMode>,
)
