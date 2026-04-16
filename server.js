import express from "express";
import cors from "cors";
import multer from "multer";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 4000;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_TO = "diego1992aguirre@gmail.com";
const TIMEZONE = "America/Mexico_City";

function formatLocalDateForICS(date) {
  const pad = (num) => String(num).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

function formatUtcDateForICS(date) {
  const pad = (num) => String(num).padStart(2, "0");
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

if (!EMAIL_USER || !EMAIL_PASS) {
  console.warn(
    "Warning: EMAIL_USER or EMAIL_PASS is not set in the environment."
  );
}

// CORS: localhost in dev, or set FRONTEND_URL in production (e.g. https://your-app.vercel.app)
const FRONTEND_URL = process.env.FRONTEND_URL;
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (origin.startsWith("http://localhost")) return callback(null, true);
      if (FRONTEND_URL && origin === FRONTEND_URL) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
  })
);

app.post("/send-email", upload.single("pdf"), async (req, res) => {
  try {
    const { subject, date, time, message: customMessage, recipients } = req.body;
    const file = req.file;

    if (!subject || !date || !time || !file) {
      return res
        .status(400)
        .json({ error: "Subject, date, time and PDF file are required." });
    }

    if (!EMAIL_USER || !EMAIL_PASS) {
      return res
        .status(500)
        .json({ error: "Email credentials are not configured on the server." });
    }
    const startLocal = new Date(`${date}T${time}:00`);
    const endLocal = new Date(startLocal.getTime() + 60 * 60 * 1000);

    const dayOfMonth = startLocal.getDate();
    const monthIndex = startLocal.getMonth();
    const monthsEs = [
      "enero",
      "febrero",
      "marzo",
      "abril",
      "mayo",
      "junio",
      "julio",
      "agosto",
      "septiembre",
      "octubre",
      "noviembre",
      "diciembre",
    ];
    const daysEs = [
      "domingo",
      "lunes",
      "martes",
      "miércoles",
      "jueves",
      "viernes",
      "sábado",
    ];
    const monthName = monthsEs[monthIndex] ?? "";
    const weekdayName = daysEs[startLocal.getDay()] ?? "";
    const longDateEs = `${weekdayName} ${dayOfMonth} de ${monthName} de ${startLocal.getFullYear()}`;

    const [hourStr = "0", minuteStr = "00"] = time.split(":");
    let hourNum = Number(hourStr);
    if (Number.isNaN(hourNum)) hourNum = 0;
    const isPM = hourNum >= 12;
    let hour12 = hourNum % 12;
    if (hour12 === 0) hour12 = 12;
    const period = isPM ? "p.m." : "a.m.";
    const formattedTime = `${hour12}:${minuteStr} ${period}`;

    const dtStartLocal = formatLocalDateForICS(startLocal);
    const dtEndLocal = formatLocalDateForICS(endLocal);
    const dtStamp = formatUtcDateForICS(new Date());
    const uid = `${Date.now()}@verum-mail`;

    const fullTitle = `Comité de Calificación - ${subject}`;
    const trimmedCustom = customMessage && String(customMessage).trim();

    const { data: configRow } = await supabase
      .from("config")
      .select("value")
      .eq("key", "meeting_link")
      .single();
    const meetingLink = configRow?.value ?? "https://teams.live.com/meet/9330207434019?p=11pDHEIX4Cep47Qc3Z";

    const baseTemplateTextMain =
      "Estimados miembros del comité\n\n" +
      `Los estamos convocando el próximo ${longDateEs}, a las ${formattedTime} ` +
      `con la finalidad de revisar la calificación de ${subject}.`;
    const customBlock = trimmedCustom ? `\n\n${String(trimmedCustom)}` : "";
    const teamsText =
      "\n\nReunión de Microsoft Teams\n" +
      `Unirse: ${meetingLink}\n` +
      "Saludos,";
    const textForEmail = `${baseTemplateTextMain}${customBlock}${teamsText}`;

    const baseHtmlMain =
      "<p>Estimados miembros del comité</p>" +
      `<p>Los estamos convocando el próximo <strong>${longDateEs}</strong>, a las <strong>${formattedTime}</strong> ` +
      `con la finalidad de revisar la calificación de ${subject}.</p>`;
    const customHtml = trimmedCustom
      ? `<p>${String(trimmedCustom).replace(/\n/g, "<br />")}</p>`
      : "";
    const teamsHtml =
      `<p style=\"font-size:15pt;font-weight:bold;\">Reunión de Microsoft Teams<br />` +
      `Unirse: <a href="${meetingLink}">${meetingLink}</a></p>` +
      "<p>Saludos,</p>";
    const htmlForEmail = `${baseHtmlMain}${customHtml}${teamsHtml}`;

    let toList: string[] = [];
    if (typeof recipients === "string") {
      try {
        const parsed = JSON.parse(recipients);
        if (Array.isArray(parsed)) {
          toList = parsed.filter((v) => typeof v === "string");
        }
      } catch {
        // ignore
      }
    } else if (Array.isArray(recipients)) {
      toList = recipients.filter((v) => typeof v === "string");
    }
    if (toList.length === 0) {
      toList = [EMAIL_TO];
    }

    const icsContent = [
      "BEGIN:VCALENDAR",
      "PRODID:-//Verum Mail//EN",
      "VERSION:2.0",
      "CALSCALE:GREGORIAN",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART;TZID=${TIMEZONE}:${dtStartLocal}`,
      `DTEND;TZID=${TIMEZONE}:${dtEndLocal}`,
      `SUMMARY:${fullTitle}`,
      `DESCRIPTION:${textForEmail.replace(/\n/g, "\\n")}`,
      `ORGANIZER;CN=Verum Committee:mailto:${EMAIL_USER}`,
      `ATTENDEE;CN=Diego Aguirre;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${EMAIL_TO}`,
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: EMAIL_USER,
      to: toList.join(", "),
      subject: fullTitle,
      text: textForEmail,
      html: htmlForEmail,
      icalEvent: {
        filename: "invite.ics",
        method: "REQUEST",
        content: icsContent,
      },
      attachments: [
        {
          filename: file.originalname,
          content: file.buffer,
        },
      ],
    };

    await transporter.sendMail(mailOptions);

    return res.json({ success: true });
  } catch (error) {
    console.error("Error sending email:", error);
    return res.status(500).json({ error: "Failed to send email." });
  }
});

app.listen(PORT, () => {
  console.log(`Email server listening on http://localhost:${PORT}`);
});

