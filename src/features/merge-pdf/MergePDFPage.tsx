import { useRef, useState, DragEvent, ChangeEvent } from "react";
import "./merge-pdf.css";

interface PDFFile {
  id: string;
  file: File;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MergePDFPage() {
  const [files, setFiles] = useState<PDFFile[]>([]);
  const [addPageNumbers, setAddPageNumbers] = useState(false);
  const [outputName, setOutputName] = useState("merged");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── File helpers ──────────────────────────────────────────────────────────

  function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    const accepted = Array.from(incoming).filter((f) => {
      const name = f.name.toLowerCase();
      return name.endsWith(".pdf") || name.endsWith(".docx");
    });
    if (accepted.length === 0) return;
    setFiles((prev) => [
      ...prev,
      ...accepted.map((f) => ({ id: crypto.randomUUID(), file: f })),
    ]);
    setStatus(null);
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function moveFile(index: number, direction: -1 | 1) {
    setFiles((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
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
    addFiles(e.dataTransfer.files);
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    addFiles(e.target.files);
    e.target.value = "";
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleMerge() {
    if (files.length < 1) {
      setStatus({ type: "error", msg: "Agrega al menos un archivo PDF." });
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      const formData = new FormData();
      files.forEach(({ file }) => formData.append("files", file));
      formData.append("addPageNumbers", String(addPageNumbers));
      const name = outputName.trim() || "merged";
      formData.append("outputName", name.endsWith(".pdf") ? name : `${name}.pdf`);

      const res = await fetch("/api/merge-pdf", { method: "POST", body: formData });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error || `Error ${res.status}`);
      }

      // Trigger download
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name.endsWith(".pdf") ? name : `${name}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setStatus({ type: "success", msg: "¡PDF combinado descargado con éxito!" });
    } catch (err) {
      setStatus({
        type: "error",
        msg: err instanceof Error ? err.message : "Error al combinar los PDFs.",
      });
    } finally {
      setLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mp-page">
      <h1>Merge PDF</h1>
      <p className="mp-subtitle">
        Combina varios archivos PDF en uno solo y agrega numeración de páginas opcional.
      </p>

      {/* Drop zone */}
      <div className="mp-card">
        <p className="mp-card-title">Archivos PDF</p>

        <div
          className={`mp-drop-zone${dragOver ? " mp-drag-over" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="mp-drop-icon">📄</div>
          <p className="mp-drop-label">
            Haz clic o arrastra tus archivos PDF aquí
          </p>
          <p className="mp-drop-hint">Archivos .pdf y .docx (los .docx se convierten automáticamente)</p>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple
            onChange={onInputChange}
          />
        </div>

        {/* File list */}
        {files.length === 0 ? (
          <p className="mp-empty">Ningún archivo seleccionado</p>
        ) : (
          <ul className="mp-file-list">
            {files.map(({ id, file }, i) => (
              <li key={id} className="mp-file-item">
                <span className="mp-file-icon">
                  {file.name.toLowerCase().endsWith(".docx") ? "📝" : "📄"}
                </span>
                <span className="mp-file-name">{file.name}</span>
                <span className="mp-file-size">{formatBytes(file.size)}</span>
                <div className="mp-file-actions">
                  <button
                    className="mp-btn-icon"
                    title="Subir"
                    disabled={i === 0}
                    onClick={() => moveFile(i, -1)}
                  >
                    ▲
                  </button>
                  <button
                    className="mp-btn-icon"
                    title="Bajar"
                    disabled={i === files.length - 1}
                    onClick={() => moveFile(i, 1)}
                  >
                    ▼
                  </button>
                  <button
                    className="mp-btn-icon mp-btn-remove"
                    title="Eliminar"
                    onClick={() => removeFile(id)}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Options */}
      <div className="mp-card">
        <p className="mp-card-title">Opciones</p>
        <div className="mp-options">
          <div className="mp-option-row">
            <input
              id="mp-page-numbers"
              type="checkbox"
              className="mp-checkbox"
              checked={addPageNumbers}
              onChange={(e) => setAddPageNumbers(e.target.checked)}
            />
            <label htmlFor="mp-page-numbers">Agregar números de página</label>
          </div>

          <div className="mp-option-row">
            <label htmlFor="mp-output-name">Nombre del archivo:</label>
            <input
              id="mp-output-name"
              type="text"
              className="mp-input"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              placeholder="merged"
            />
            <span style={{ fontSize: "0.85rem", color: "#9ca3af" }}>.pdf</span>
          </div>
        </div>
      </div>

      {/* Action */}
      <button
        className="mp-btn-submit"
        onClick={handleMerge}
        disabled={loading || files.length < 1}
      >
        {loading ? (
          <>
            <span className="mp-spinner" />
            Combinando…
          </>
        ) : (
          <>📑 Combinar PDFs</>
        )}
      </button>

      {status && (
        <div className={`mp-status mp-${status.type}`}>{status.msg}</div>
      )}
    </div>
  );
}
