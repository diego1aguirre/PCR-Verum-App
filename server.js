import express from "express";
import cors from "cors";
import multer from "multer";
import { Resend } from "resend";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 4000;
const EMAIL_FROM = process.env.EMAIL_USER;
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
    `ORGANIZER;CN=Verum Committee:mailto:${EMAIL_FROM}`,
    `ATTENDEE;CN=Diego Aguirre;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${EMAIL_TO}`,
    "END:VEVENT","END:VCALENDAR","",
  ].join("\r\n");

  const toList = Array.isArray(recipients) && recipients.length
    ? recipients.filter((v) => typeof v === "string")
    : [EMAIL_TO];

  const resend = new Resend(process.env.RESEND_API_KEY);

  const { error } = await resend.emails.send({
    from: `Comité Verum <${EMAIL_FROM}>`,
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
    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ error: "RESEND_API_KEY is not configured." });
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
    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ error: "RESEND_API_KEY is not configured." });
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

// Serve built frontend
const distPath = join(__dirname, "dist");
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("/{*splat}", (_req, res) => res.sendFile(join(distPath, "index.html")));
}

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
