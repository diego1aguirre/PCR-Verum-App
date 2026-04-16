import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import "./verum-mail.css";

/** Subject = everything before the first "_" in the filename */
function subjectFromFilename(filename: string): string {
  const base = filename.replace(/\.pdf$/i, "");
  const idx = base.indexOf("_");
  if (idx === -1) return base.trim();
  return base.slice(0, idx).trim();
}

const MONTHS: Record<string, number> = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, aug: 8, sep: 9, oct: 10, nov: 11, dic: 12, dec: 12,
};

/** Parse date from filename: "25.Oct.2019" or "Feb.23.2026" → yyyy-mm-dd */
function dateFromFilename(filename: string): string {
  const base = filename.replace(/\.pdf$/i, "");
  const ddm = base.match(/(\d{1,2})\.(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic|Jan|Apr|Aug|Dec)\.(\d{4})/i);
  if (ddm) {
    const day = parseInt(ddm[1], 10);
    const month = MONTHS[ddm[2].toLowerCase().slice(0, 3)];
    const year = parseInt(ddm[3], 10);
    if (month && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  const mdy = base.match(/(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic|Jan|Apr|Aug|Dec)\.(\d{1,2})\.(\d{4})/i);
  if (mdy) {
    const month = MONTHS[mdy[1].toLowerCase().slice(0, 3)];
    const day = parseInt(mdy[2], 10);
    const year = parseInt(mdy[3], 10);
    if (month && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return "";
}

export default function VerumMailPage() {
  const [subject, setSubject] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [message, setMessage] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [recipients, setRecipients] = useState<{ id: string; email: string }[]>([]);
  const [newRecipient, setNewRecipient] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [view, setView] = useState<"compose" | "manage">("compose");
  const [meetingLink, setMeetingLink] = useState("");
  const [newMeetingLink, setNewMeetingLink] = useState("");
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkSaved, setLinkSaved] = useState(false);

  useEffect(() => {
    supabase
      .from("recipients")
      .select("id, email")
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data) setRecipients(data);
      });

    supabase
      .from("config")
      .select("value")
      .eq("key", "meeting_link")
      .single()
      .then(({ data }) => {
        if (data?.value) {
          setMeetingLink(data.value);
          setNewMeetingLink(data.value);
        }
      });
  }, []);

  const handleSaveMeetingLink = async () => {
    const trimmed = newMeetingLink.trim();
    if (!trimmed || trimmed === meetingLink) return;
    setLinkSaving(true);
    const { error } = await supabase
      .from("config")
      .update({ value: trimmed })
      .eq("key", "meeting_link");
    if (!error) {
      setMeetingLink(trimmed);
      setLinkSaved(true);
      setTimeout(() => setLinkSaved(false), 2500);
    }
    setLinkSaving(false);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setPdfFile(file);
    if (file) {
      const parsedSubject = subjectFromFilename(file.name);
      const parsedDate = dateFromFilename(file.name);
      if (parsedSubject) setSubject(parsedSubject);
      if (parsedDate) setDate(parsedDate);
    }
  };

  const handleAddRecipient = async () => {
    const trimmed = newRecipient.trim();
    if (!trimmed) return;
    if (recipients.some((r) => r.email === trimmed)) {
      setNewRecipient("");
      return;
    }
    const { data, error } = await supabase
      .from("recipients")
      .insert({ email: trimmed })
      .select("id, email")
      .single();
    if (!error && data) {
      setRecipients((prev) => [...prev, data]);
    }
    setNewRecipient("");
  };

  const handleRemoveRecipient = async (id: string) => {
    const { error } = await supabase.from("recipients").delete().eq("id", id);
    if (!error) {
      setRecipients((prev) => prev.filter((r) => r.id !== id));
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;

    if (!subject.trim() || !date || !time || !pdfFile) {
      setError("Completa todos los campos y adjunta un PDF.");
      setSuccess(null);
      return;
    }

    setError(null);
    setSuccess(null);
    setIsSending(true);

    try {
      const apiBase = import.meta.env.VITE_API_URL ?? "";
      const useVercelApi = !apiBase;

      let response: Response;
      if (useVercelApi) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            resolve(dataUrl.split(",")[1] ?? "");
          };
          reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
          reader.readAsDataURL(pdfFile);
        });
        response = await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: subject.trim(),
            date,
            time,
            message: message.trim(),
            pdfBase64: base64,
            pdfFilename: pdfFile.name,
            recipients: recipients.map((r) => r.email),
          }),
        });
      } else {
        const formData = new FormData();
        formData.append("subject", subject.trim());
        formData.append("date", date);
        formData.append("time", time);
        formData.append("message", message.trim());
        formData.append("pdf", pdfFile);
        formData.append("recipients", JSON.stringify(recipients.map((r) => r.email)));
        response = await fetch(`${apiBase}/send-email`, {
          method: "POST",
          body: formData,
        });
      }

      const data = await response.json().catch(() => ({ success: response.ok }));

      if (!response.ok || !data?.success) {
        const msg =
          (data && typeof data.error === "string" && data.error) ||
          "No se pudo enviar el correo. Inténtalo de nuevo.";
        throw new Error(msg);
      }

      setSuccess("Correo enviado correctamente.");
      setSubject("");
      setDate("");
      setTime("");
      setMessage("");
      setPdfFile(null);

      const pdfInput = form.elements.namedItem("pdf") as HTMLInputElement | null;
      if (pdfInput) pdfInput.value = "";
    } catch (sendError: unknown) {
      const msg =
        sendError instanceof Error
          ? sendError.message
          : "No se pudo enviar el correo. Inténtalo de nuevo.";
      setError(msg);
      setSuccess(null);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="vm-app">
      <header className="vm-app-header">
        <div>
          <h1>Verum Mail</h1>
          <p>Crea correos de comité con adjuntos.</p>
        </div>
        <button
          type="button"
          className="vm-settings-button"
          onClick={() => setView(view === "compose" ? "manage" : "compose")}
          aria-label={view === "compose" ? "Administrar destinatarios" : "Regresar al formulario"}
        >
          {view === "compose" ? (
            <span className="vm-icon-gear" aria-hidden="true">⚙</span>
          ) : (
            "Regresar"
          )}
        </button>
      </header>

      <main className="vm-app-main">
        {view === "compose" ? (
          <section className="vm-card">
            <h2>Crear sesión de comité</h2>
            <form onSubmit={handleSubmit} className="vm-form">
              <label className="vm-field">
                <span>Adjunto PDF</span>
                <input
                  type="file"
                  name="pdf"
                  accept="application/pdf,.pdf"
                  onChange={handleFileChange}
                />
              </label>

              {pdfFile && (
                <p className="vm-hint">
                  Archivo: <strong>{pdfFile.name}</strong>
                </p>
              )}

              <label className="vm-field">
                <span>Emisor</span>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Nombre del Emisor"
                />
              </label>

              <label className="vm-field">
                <span>Cuerpo del correo</span>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Déjalo vacío para usar el mensaje predeterminado del comité, o escribe tu propio texto."
                  rows={5}
                />
              </label>

              <div className="vm-field-grid">
                <label className="vm-field">
                  <span>Fecha</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <label className="vm-field">
                  <span>Hora</span>
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </label>
              </div>

              {error && <p className="vm-error">{error}</p>}
              {success && <p className="vm-success">{success}</p>}

              <button type="submit" className="vm-primary-button" disabled={isSending}>
                {isSending ? "Enviando..." : "Enviar correo"}
              </button>
            </form>
          </section>
        ) : (
          <section className="vm-card">
            <h2>Administrar destinatarios</h2>
            <div className="vm-form">
              <div className="vm-field">
                <span>Agregar correo destinatario</span>
                <div className="vm-field-grid">
                  <input
                    type="email"
                    value={newRecipient}
                    onChange={(e) => setNewRecipient(e.target.value)}
                    placeholder="ej. usuario@empresa.com"
                    onKeyDown={(e) => e.key === "Enter" && handleAddRecipient()}
                  />
                  <button
                    type="button"
                    className="vm-primary-button"
                    onClick={handleAddRecipient}
                  >
                    Agregar
                  </button>
                </div>
              </div>

              {recipients.length > 0 && (
                <div className="vm-field">
                  <span>Destinatarios actuales</span>
                  <ul className="vm-recipient-list">
                    {recipients.map((r) => (
                      <li key={r.id} className="vm-recipient-item">
                        <span>{r.email}</span>
                        <button
                          type="button"
                          className="vm-recipient-remove"
                          onClick={() => handleRemoveRecipient(r.id)}
                        >
                          Eliminar
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <hr className="vm-section-divider" />

              <div className="vm-field">
                <span>Liga de reunión</span>
                <div className="vm-field-grid">
                  <input
                    type="url"
                    value={newMeetingLink}
                    onChange={(e) => {
                      setNewMeetingLink(e.target.value);
                      setLinkSaved(false);
                    }}
                    placeholder="https://teams.live.com/meet/..."
                  />
                  <button
                    type="button"
                    className="vm-primary-button"
                    onClick={handleSaveMeetingLink}
                    disabled={linkSaving || !newMeetingLink.trim() || newMeetingLink.trim() === meetingLink}
                  >
                    {linkSaving ? "Guardando…" : "Guardar"}
                  </button>
                </div>
                {linkSaved && (
                  <p className="vm-success" style={{ marginTop: "0.5rem" }}>
                    Liga actualizada correctamente.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
