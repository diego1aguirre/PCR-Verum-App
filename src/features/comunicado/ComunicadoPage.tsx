import { useRef, useState, DragEvent, ChangeEvent } from "react";
import "./comunicado.css";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type OutputFormat = "docx" | "pdf";

export default function ComunicadoPage() {
  const [file, setFile] = useState<File | null>(null);
  const [output, setOutput] = useState<OutputFormat>("docx");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── File helpers ──────────────────────────────────────────────────────────

  function pickFile(f: File | null) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".docx")) {
      setStatus({ type: "error", msg: "Solo se aceptan archivos .docx." });
      return;
    }
    setFile(f);
    setStatus(null);
  }

  // ── Drag & drop ───────────────────────────────────────────────────────────

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(true);
  }

  function onDragLeave() {
    setDragOver(false);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    pickFile(e.dataTransfer.files[0] ?? null);
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    pickFile(e.target.files?.[0] ?? null);
    e.target.value = "";
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleProcess() {
    if (!file) return;
    setLoading(true);
    setStatus(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("output", output);

      const res = await fetch("/api/comunicado", { method: "POST", body: formData });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error || `Error ${res.status}`);
      }

      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const base = file.name.replace(/\.docx$/i, "");
      const fallbackExt = output === "pdf" ? ".pdf" : "_plain.docx";
      const filename = match?.[1] ?? `ComPrensa_${base}${fallbackExt}`;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setStatus({ type: "success", msg: "¡Documento procesado y descargado con éxito!" });
    } catch (err) {
      setStatus({
        type: "error",
        msg: err instanceof Error ? err.message : "Error al procesar el documento.",
      });
    } finally {
      setLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="co-page">
      <h1>Comunicado</h1>
      <p className="co-subtitle">
        Reformatea un comunicado .docx al formato ComPrensa: Aptos 12pt, interlineado simple, justificado.
      </p>

      {/* Upload */}
      <div className="co-card">
        <p className="co-card-title">Archivo .docx</p>

        <div
          className={`co-drop-zone${dragOver ? " co-drag-over" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="co-drop-icon">📝</div>
          <p className="co-drop-label">Haz clic o arrastra tu archivo aquí</p>
          <p className="co-drop-hint">Solo archivos .docx</p>
          <input
            ref={inputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={onInputChange}
          />
        </div>

        {file && (
          <div className="co-file-pill">
            <span>📎</span>
            <span className="co-file-pill-name">{file.name}</span>
            <span className="co-file-pill-size">{formatBytes(file.size)}</span>
            <button
              className="co-file-pill-remove"
              title="Quitar archivo"
              onClick={(e) => { e.stopPropagation(); setFile(null); setStatus(null); }}
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Output format */}
      <div className="co-card">
        <p className="co-card-title">Formato de salida</p>
        <div className="co-format-group">
          <label className={`co-format-option${output === "docx" ? " co-format-active" : ""}`}>
            <input
              type="radio"
              name="output"
              value="docx"
              checked={output === "docx"}
              onChange={() => setOutput("docx")}
            />
            <span className="co-format-icon">📄</span>
            <span className="co-format-label">Word (.docx)</span>
          </label>
          <label className={`co-format-option${output === "pdf" ? " co-format-active" : ""}`}>
            <input
              type="radio"
              name="output"
              value="pdf"
              checked={output === "pdf"}
              onChange={() => setOutput("pdf")}
            />
            <span className="co-format-icon">📕</span>
            <span className="co-format-label">PDF</span>
          </label>
        </div>
      </div>

      {/* Info */}
      <div className="co-card">
        <p className="co-card-title">¿Qué hace?</p>
        <div className="co-info">
          El procesador lee tu comunicado y genera una versión limpia con:
          <ul>
            <li>Fuente <strong>Aptos 12pt</strong></li>
            <li>Texto <strong>justificado</strong></li>
            <li>Interlineado simple, sin espaciado entre párrafos</li>
            <li>Párrafo vacío separador entre cada bloque de contenido</li>
            <li>Tablas de calificación y analistas procesadas automáticamente</li>
          </ul>
        </div>
      </div>

      {/* Action */}
      <button
        className="co-btn-submit"
        onClick={handleProcess}
        disabled={loading || !file}
      >
        {loading ? (
          <>
            <span className="co-spinner" />
            Procesando…
          </>
        ) : (
          <>📄 Procesar documento</>
        )}
      </button>

      {status && (
        <div className={`co-status co-${status.type}`}>{status.msg}</div>
      )}
    </div>
  );
}
