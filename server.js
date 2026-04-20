import express from "express";
import cors from "cors";
import multer from "multer";
import { Resend } from "resend";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { writeFile, readFile, rm, mkdir } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { processComunicado } from "./comunicado-processor.js";

const execFileAsync = promisify(execFile);

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// ─── LibreOffice DOCX → PDF helper ───────────────────────────────────────────

// Candidate paths tried in order. apt installs soffice at /usr/bin/soffice
// (a wrapper script) and the real binary at /usr/lib/libreoffice/program/soffice.
const _SOFFICE_CANDIDATES = [
  "/usr/bin/soffice",                              // Debian/Ubuntu apt (Railway)
  "/usr/lib/libreoffice/program/soffice",          // Debian/Ubuntu real binary
  "/usr/bin/libreoffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice", // macOS dev
  "soffice",                                       // PATH fallback
  "libreoffice",
];

// Cache the resolved path after the first successful lookup.
let _sofficePath = null;

async function _findSoffice() {
  if (_sofficePath) return _sofficePath;
  if (process.env.SOFFICE_PATH) {
    _sofficePath = process.env.SOFFICE_PATH;
    return _sofficePath;
  }
  for (const candidate of _SOFFICE_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync(candidate, ["--version"], { timeout: 5_000 });
      console.log(`LibreOffice found at: ${candidate} — ${stdout.trim()}`);
      _sofficePath = candidate;
      return _sofficePath;
    } catch (err) {
      // ENOENT = binary not at this path; other errors = binary exists but failed
      const reason = err.code === "ENOENT" ? "not found" : `error: ${err.message}`;
      console.log(`LibreOffice candidate skipped (${candidate}): ${reason}`);
    }
  }
  throw new Error(
    "LibreOffice not found. Install it or set the SOFFICE_PATH environment variable."
  );
}

async function convertDocxToPdf(buffer) {
  const soffice = await _findSoffice();
  const id = randomUUID();
  const tempDir = join(tmpdir(), `docx2pdf-${id}`);

  // LO 7.4 does not support --user-installation=file://... as a CLI flag.
  // Instead, point HOME at the temp dir so LO creates its user profile there —
  // a writable, isolated location that is cleaned up with the rest of tempDir.
  await mkdir(tempDir, { recursive: true, mode: 0o755 });

  const inputPath = join(tempDir, "input.docx");
  try {
    await writeFile(inputPath, buffer);

    console.log(`[LO] converting ${inputPath} → PDF in ${tempDir}`);

    // --norestore: skip crash-recovery dialog (would hang headless)
    // HOME=tempDir: isolate LO user-profile to the per-conversion temp dir
    let stdout = "", stderr = "";
    try {
      ({ stdout, stderr } = await execFileAsync(soffice, [
        "--headless",
        "--norestore",
        "--convert-to", "pdf",
        "--outdir", tempDir,
        inputPath,
      ], { timeout: 60_000, env: { ...process.env, HOME: tempDir } }));
    } catch (execErr) {
      // execFileAsync rejects on non-zero exit; stdout/stderr are on the error object
      stdout = execErr.stdout ?? "";
      stderr = execErr.stderr ?? "";
      console.error("[LO] process exited with error:");
      console.error(`  exit code : ${execErr.code ?? "unknown"}`);
      console.error(`  stdout    : ${stdout || "(empty)"}`);
      console.error(`  stderr    : ${stderr || "(empty)"}`);
      throw execErr;
    }

    console.log(`[LO] stdout: ${stdout || "(empty)"}`);
    if (stderr) console.warn(`[LO] stderr: ${stderr}`);

    // Confirm the output file was actually produced before trying to read it
    const outputPath = join(tempDir, "input.pdf");
    try {
      return await readFile(outputPath);
    } catch {
      console.error(`[LO] output PDF not found at ${outputPath}`);
      console.error(`[LO] stdout was: ${stdout || "(empty)"}`);
      console.error(`[LO] stderr was: ${stderr || "(empty)"}`);
      throw new Error("LibreOffice ran but did not produce a PDF. Check Railway logs for details.");
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

const PORT = process.env.PORT || 4000;
const EMAIL_USER = process.env.EMAIL_USER;   // real sender — used once domain is verified
const EMAIL_FROM = "onboarding@resend.dev";  // TODO: switch to EMAIL_USER after DNS verification
const EMAIL_TO = "diego1992aguirre@gmail.com";
const TIMEZONE = "America/Mexico_City";

if (!process.env.RESEND_API_KEY) {
  console.warn("Warning: RESEND_API_KEY is not set.");
}

// Allow all origins — frontend and backend run on the same server in production
app.use(cors());
app.use(express.json({ limit: "20mb" }));

// ─── Shared helpers ───────────────────────────────────────────────────────────

function formatLocalDateForICS(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatUtcDateForICS(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

async function buildAndSendEmail({ subject, date, time, customMessage, pdfBuffer, pdfFilename, recipients }) {
  const startLocal = new Date(`${date}T${time}:00`);
  const endLocal = new Date(startLocal.getTime() + 60 * 60 * 1000);

  const monthsEs = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const daysEs = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
  const longDateEs = `${daysEs[startLocal.getDay()]} ${startLocal.getDate()} de ${monthsEs[startLocal.getMonth()]} de ${startLocal.getFullYear()}`;

  const [hourStr = "0", minuteStr = "00"] = time.split(":");
  let hourNum = Number(hourStr);
  if (Number.isNaN(hourNum)) hourNum = 0;
  const isPM = hourNum >= 12;
  let hour12 = hourNum % 12;
  if (hour12 === 0) hour12 = 12;
  const formattedTime = `${hour12}:${minuteStr} ${isPM ? "p.m." : "a.m."}`;

  const uid = `${Date.now()}@verum-mail`;
  const fullTitle = `Comité de Calificación - ${subject}`;
  const trimmedCustom = customMessage && String(customMessage).trim();

  const { data: configRow } = await supabase
    .from("config")
    .select("value")
    .eq("key", "meeting_link")
    .single();
  const meetingLink = configRow?.value ?? "https://teams.live.com/meet/9330207434019?p=11pDHEIX4Cep47Qc3Z";

  const baseText = `Estimados miembros del comité\n\nLos estamos convocando el próximo ${longDateEs}, a las ${formattedTime} con la finalidad de revisar la calificación de ${subject}.`;
  const customBlock = trimmedCustom ? `\n\n${trimmedCustom}` : "";
  const teamsText = `\n\nReunión de Microsoft Teams\nUnirse: ${meetingLink}\nSaludos,`;
  const textForEmail = `${baseText}${customBlock}${teamsText}`;

  const baseHtml = `<p>Estimados miembros del comité</p><p>Los estamos convocando el próximo <strong>${longDateEs}</strong>, a las <strong>${formattedTime}</strong> con la finalidad de revisar la calificación de ${subject}.</p>`;
  const customHtml = trimmedCustom ? `<p>${trimmedCustom.replace(/\n/g, "<br />")}</p>` : "";
  const teamsHtml = `<p style="font-size:15pt;font-weight:bold;">Reunión de Microsoft Teams<br />Unirse: <a href="${meetingLink}">${meetingLink}</a></p><p>Saludos,</p>`;
  const htmlForEmail = `${baseHtml}${customHtml}${teamsHtml}`;

  const icsContent = [
    "BEGIN:VCALENDAR","PRODID:-//Verum Mail//EN","VERSION:2.0","CALSCALE:GREGORIAN","METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatUtcDateForICS(new Date())}`,
    `DTSTART;TZID=${TIMEZONE}:${formatLocalDateForICS(startLocal)}`,
    `DTEND;TZID=${TIMEZONE}:${formatLocalDateForICS(endLocal)}`,
    `SUMMARY:${fullTitle}`,
    `DESCRIPTION:${textForEmail.replace(/\n/g, "\\n")}`,
    `ORGANIZER;CN=Verum Committee:mailto:${EMAIL_USER}`,
    `ATTENDEE;CN=Diego Aguirre;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${EMAIL_TO}`,
    "END:VEVENT","END:VCALENDAR","",
  ].join("\r\n");

  const toList = Array.isArray(recipients) && recipients.length
    ? recipients.filter((v) => typeof v === "string")
    : [EMAIL_TO];

  const resend = new Resend(process.env.RESEND_API_KEY);

  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: toList,
    subject: fullTitle,
    html: htmlForEmail,
    text: textForEmail,
    attachments: [
      { filename: pdfFilename, content: pdfBuffer },
      { filename: "invite.ics", content: Buffer.from(icsContent), contentType: "text/calendar" },
    ],
  });

  if (error) throw new Error(error.message);
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.post("/api/send-email", async (req, res) => {
  try {
    const { subject, date, time, message: customMessage, pdfBase64, pdfFilename, recipients } = req.body;
    if (!subject || !date || !time || !pdfBase64 || !pdfFilename) {
      return res.status(400).json({ error: "Subject, date, time and PDF file are required." });
    }
    await buildAndSendEmail({
      subject, date, time, customMessage,
      pdfBuffer: Buffer.from(pdfBase64, "base64"),
      pdfFilename, recipients,
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Error sending email:", err);
    return res.status(500).json({ error: err.message || "Failed to send email." });
  }
});

// FormData route — local dev fallback
app.post("/send-email", upload.single("pdf"), async (req, res) => {
  try {
    const { subject, date, time, message: customMessage, recipients: rawRecipients } = req.body;
    const file = req.file;
    if (!subject || !date || !time || !file) {
      return res.status(400).json({ error: "Subject, date, time and PDF file are required." });
    }
    let recipients = [];
    if (typeof rawRecipients === "string") {
      try { recipients = JSON.parse(rawRecipients); } catch { /* ignore */ }
    } else if (Array.isArray(rawRecipients)) {
      recipients = rawRecipients;
    }
    await buildAndSendEmail({
      subject, date, time, customMessage,
      pdfBuffer: file.buffer,
      pdfFilename: file.originalname,
      recipients,
    });
    return res.json({ success: true });
  } catch (err) {
    console.error("Error sending email:", err);
    return res.status(500).json({ error: err.message || "Failed to send email." });
  }
});

// ─── Merge PDF ───────────────────────────────────────────────────────────────

app.post("/api/merge-pdf", upload.array("files"), async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length < 1) {
      return res.status(400).json({ error: "Se necesita al menos un archivo PDF." });
    }

    const addPageNumbers = req.body.addPageNumbers === "true";
    const rawName = (req.body.outputName ?? "").trim();
    const outputName = rawName ? (rawName.endsWith(".pdf") ? rawName : `${rawName}.pdf`) : "merged.pdf";

    // Convert any .docx files to PDF first
    const pdfBuffers = await Promise.all(files.map(async (file) => {
      if (file.originalname.toLowerCase().endsWith(".docx")) {
        return convertDocxToPdf(file.buffer);
      }
      return file.buffer;
    }));

    // Merge all PDFs in order
    const mergedPdf = await PDFDocument.create();
    for (const pdfBuffer of pdfBuffers) {
      const pdf = await PDFDocument.load(pdfBuffer);
      const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      pages.forEach((page) => mergedPdf.addPage(page));
    }

    // Optionally stamp "Pag. n/total" in the top-right corner
    if (addPageNumbers) {
      const font = await mergedPdf.embedFont(StandardFonts.Helvetica);
      const pages = mergedPdf.getPages();
      const total = pages.length;
      const fontSize = 18;
      pages.forEach((page, i) => {
        const text = `Pag. ${i + 1}/${total}`;
        const textWidth = font.widthOfTextAtSize(text, fontSize);
        page.drawText(text, {
          x: page.getWidth() - textWidth - 20,
          y: page.getHeight() - 35,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });
      });
    }

    const mergedBytes = await mergedPdf.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${outputName}"`);
    res.send(Buffer.from(mergedBytes));
  } catch (err) {
    console.error("Error merging PDFs:", err);
    return res.status(500).json({ error: err.message || "Error al combinar los PDFs." });
  }
});

// ─── Comunicado ──────────────────────────────────────────────────────────────

app.post("/api/comunicado", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No se proporcionó ningún archivo." });
    if (!file.originalname.toLowerCase().endsWith(".docx")) {
      return res.status(400).json({ error: "Solo se aceptan archivos .docx." });
    }

    const wantPdf = req.body.output === "pdf";

    if (wantPdf) {
      // PDF = original uploaded file converted as-is (no reformatting)
      const pdfBuffer = await convertDocxToPdf(file.buffer);
      const pdfFilename = file.originalname.replace(/\.docx$/i, ".pdf");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${pdfFilename}"`);
      return res.send(pdfBuffer);
    }

    // DOCX = reformatted version
    const { buffer: docxBuffer, filename: docxFilename } = await processComunicado(file.buffer, file.originalname);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${docxFilename}"`);
    res.send(docxBuffer);
  } catch (err) {
    console.error("Error processing comunicado:", err);
    return res.status(500).json({ error: err.message || "Error al procesar el documento." });
  }
});

// Serve built frontend
const distPath = join(__dirname, "dist");
if (existsSync(distPath)) {
  // Hashed assets (JS/CSS) can be cached forever; index.html must never be cached
  app.use(express.static(distPath, {
    setHeaders(res, filePath) {
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    },
  }));
  app.get("/{*splat}", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(join(distPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  // Log LibreOffice availability at startup
  _findSoffice()
    .then((p) => console.log(`LibreOffice found: ${p}`))
    .catch(() => console.warn("LibreOffice not found — PDF conversion will be unavailable."));
});
