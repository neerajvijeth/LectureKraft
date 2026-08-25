import { Navigate, Route, Routes } from 'react-router-dom'
import { LandingPage } from '@/features/landing/LandingPage'
import { SessionShell } from '@/features/SessionShell'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/s/:sessionId" element={<SessionShell />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
