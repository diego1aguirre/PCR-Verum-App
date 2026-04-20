import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import VerumMail from './pages/VerumMail'
import Comunicado from './pages/Comunicado'
import MergePDF from './pages/MergePDF'
import Configuracion from './pages/Configuracion'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/verum-mail" replace />} />
        <Route path="verum-mail" element={<VerumMail />} />
        <Route path="comunicado" element={<Comunicado />} />
        <Route path="merge-pdf" element={<MergePDF />} />
        <Route path="configuracion" element={<Configuracion />} />
      </Route>
    </Routes>
  )
}
