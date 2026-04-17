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

// Candidate paths for the soffice/libreoffice binary (mirrors the Python app's list)
const _SOFFICE_CANDIDATES = [
  "soffice",
  "libreoffice",
  "/usr/bin/soffice",
  "/usr/bin/libreoffice",
  "/usr/lib/libreoffice/program/soffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice", // macOS
];

async function _findSoffice() {
  if (process.env.SOFFICE_PATH) return process.env.SOFFICE_PATH;
  for (const candidate of _SOFFICE_CANDIDATES) {
    try {
      await execFileAsync(candidate, ["--version"], { timeout: 5_000 });
      return candidate;
    } catch {
      // not found or not executable — try next
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
  await mkdir(tempDir, { recursive: true });
  const inputPath = join(tempDir, "input.docx");
  try {
    await writeFile(inputPath, buffer);
    await execFileAsync(soffice, [
      "--headless", "--convert-to", "pdf", "--outdir", tempDir, inputPath,
    ], { timeout: 60_000 });
    return await readFile(join(tempDir, "input.pdf"));
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

    // Always reformat the docx first
    const { buffer: docxBuffer, filename: docxFilename } = await processComunicado(file.buffer, file.originalname);

    if (wantPdf) {
      const pdfBuffer = await convertDocxToPdf(docxBuffer);
      const pdfFilename = docxFilename.replace(/\.docx$/i, ".pdf");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${pdfFilename}"`);
      return res.send(pdfBuffer);
    }

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
  app.use(express.static(distPath));
  app.get("/{*splat}", (_req, res) => res.sendFile(join(distPath, "index.html")));
}

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  // Log LibreOffice availability at startup
  _findSoffice()
    .then((p) => console.log(`LibreOffice found: ${p}`))
    .catch(() => console.warn("LibreOffice not found — PDF conversion will be unavailable."));
});
