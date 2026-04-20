import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      navigate("/verum-mail", { replace: true });
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#F5F4F2",
      fontFamily: '"Segoe UI", system-ui, sans-serif',
    }}>
      <div style={{
        background: "#ffffff",
        borderRadius: 14,
        boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
        padding: "40px 44px",
        width: "100%",
        maxWidth: 380,
      }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <img
            src="https://pcrverum.mx/wp-content/uploads/2021/08/logo.cliente.png"
            alt="PCR Verum"
            style={{ maxWidth: 150 }}
          />
        </div>

        <h1 style={{
          fontSize: "1.2rem",
          fontWeight: 700,
          color: "#231F20",
          margin: "0 0 6px",
          textAlign: "center",
        }}>
          Iniciar sesión
        </h1>
        <p style={{
          fontSize: "0.88rem",
          color: "#9ca3af",
          textAlign: "center",
          margin: "0 0 28px",
        }}>
          Accede a las herramientas de PCR Verum
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "#374151" }}>
              Correo electrónico
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="usuario@verum.mx"
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: "1.5px solid #e5e7eb",
                fontSize: "0.92rem",
                color: "#231F20",
                outline: "none",
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#F48220")}
              onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "#374151" }}>
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: "1.5px solid #e5e7eb",
                fontSize: "0.92rem",
                color: "#231F20",
                outline: "none",
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#F48220")}
              onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")}
            />
          </div>

          {error && (
            <div style={{
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              padding: "10px 12px",
              fontSize: "0.85rem",
              color: "#dc2626",
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 4,
              padding: "11px 0",
              background: loading ? "#f9a86a" : "#F48220",
              color: "#ffffff",
              fontWeight: 600,
              fontSize: "0.95rem",
              border: "none",
              borderRadius: 8,
              cursor: loading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              transition: "background 0.15s",
            }}
          >
            {loading ? (
              <>
                <span style={{
                  width: 16,
                  height: 16,
                  border: "2px solid rgba(255,255,255,0.4)",
                  borderTopColor: "#ffffff",
                  borderRadius: "50%",
                  animation: "spin 0.65s linear infinite",
                  flexShrink: 0,
                }} />
                Entrando…
              </>
            ) : (
              "Iniciar sesión"
            )}
          </button>
        </form>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
