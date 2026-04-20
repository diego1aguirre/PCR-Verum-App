import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

const SIDEBAR_WIDTH = 210

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: SIDEBAR_WIDTH,
    minWidth: SIDEBAR_WIDTH,
    height: '100vh',
    backgroundColor: '#FFFFFF',
    borderRight: '0.5px solid #e0ddd8',
    display: 'flex',
    flexDirection: 'column',
    position: 'sticky',
    top: 0,
  },
  logoWrapper: {
    padding: '1.25rem',
    borderBottom: '0.5px solid #e0ddd8',
  },
  logo: {
    maxWidth: 140,
    display: 'block',
  },
  nav: {
    flex: 1,
    padding: '1rem 0',
    overflowY: 'auto',
  },
  section: {
    marginBottom: '1.25rem',
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.08em',
    color: '#b0aead',
    padding: '0 1rem',
    marginBottom: '0.25rem',
  },
  footer: {
    padding: '1rem',
    borderTop: '0.5px solid #e0ddd8',
    display: 'flex',
    alignItems: 'center',
    gap: '0.625rem',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    backgroundColor: '#F48220',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  },
  userName: {
    fontSize: 13,
    color: '#231F20',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
}

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
}

function NavItemLink({ to, label, icon }: NavItem) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: '0.625rem',
        padding: '0.5rem 1rem',
        textDecoration: 'none',
        fontSize: 13,
        fontWeight: 500,
        color: isActive ? '#231F20' : '#808184',
        backgroundColor: isActive ? '#FEF8F2' : 'transparent',
        borderLeft: isActive ? '3px solid #F48220' : '3px solid transparent',
        transition: 'background-color 0.15s, color 0.15s',
      })}
    >
      <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        {icon}
      </span>
      {label}
    </NavLink>
  )
}

// Icons
function IconMail() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <polyline points="2,4 12,13 22,4" />
    </svg>
  )
}

function IconFile() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  )
}

function IconMergePDF() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2" />
      <rect x="10" y="2" width="12" height="14" rx="2" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

const herramientas: NavItem[] = [
  { to: '/verum-mail', label: 'Verum Mail', icon: <IconMail /> },
  { to: '/comunicado', label: 'Comunicado', icon: <IconFile /> },
  { to: '/merge-pdf', label: 'Merge PDF', icon: <IconMergePDF /> },
]

const ajustes: NavItem[] = [
  { to: '/configuracion', label: 'Configuración', icon: <IconSettings /> },
]

function getInitials(email: string): string {
  const local = email.split("@")[0]
  const parts = local.split(/[._-]/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return local.slice(0, 2).toUpperCase()
}

export default function Sidebar() {
  const { session } = useAuth()
  const email = session?.user?.email ?? ""
  const initials = email ? getInitials(email) : "?"

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  return (
    <aside style={styles.sidebar}>
      <div style={styles.logoWrapper}>
        <img
          src="https://pcrverum.mx/wp-content/uploads/2021/08/logo.cliente.png"
          alt="PCR Verum"
          style={styles.logo}
        />
      </div>

      <nav style={styles.nav}>
        <div style={styles.section}>
          <p style={styles.sectionLabel}>HERRAMIENTAS</p>
          {herramientas.map((item) => (
            <NavItemLink key={item.to} {...item} />
          ))}
        </div>

        <div style={styles.section}>
          <p style={styles.sectionLabel}>AJUSTES</p>
          {ajustes.map((item) => (
            <NavItemLink key={item.to} {...item} />
          ))}
        </div>
      </nav>

      <div style={styles.footer}>
        <div style={styles.avatar}>{initials}</div>
        <span style={{ ...styles.userName, flex: 1, minWidth: 0 }}>{email}</span>
        <button
          onClick={handleSignOut}
          title="Cerrar sesión"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#9ca3af",
            padding: 4,
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#ef4444")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#9ca3af")}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </aside>
  )
}
