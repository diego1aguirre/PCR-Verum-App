/**
 * comunicado-processor.js
 * Node.js port of processor.py from Comunicado-app.
 *
 * Reads a formatted comunicado .docx and produces a plain-formatted version:
 *   - Aptos font, 12pt
 *   - No paragraph spacing (before/after = 0)
 *   - Single line spacing (240)
 *   - Empty paragraph between each content paragraph
 *   - Justified text
 */

import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { Document, Paragraph, TextRun, AlignmentType, Packer } from "docx";
import path from "path";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const HEADER_STYLES = new Set(["MetodologasyAnalistas", "MetodologíasyAnalistas"]);

// ── XML helpers ──────────────────────────────────────────────────────────────

function getParaStyle(p) {
  const els = p.getElementsByTagNameNS(W_NS, "pStyle");
  if (!els.length) return "Normal";
  const el = els[0];
  return el.getAttributeNS(W_NS, "val") || el.getAttribute("w:val") || "Normal";
}

function getParaText(p) {
  const ts = p.getElementsByTagNameNS(W_NS, "t");
  let out = "";
  for (let i = 0; i < ts.length; i++) out += ts[i].textContent || "";
  return out;
}

function paraIsListItem(p) {
  return p.getElementsByTagNameNS(W_NS, "numPr").length > 0;
}

function tableIsMultiPara(tbl) {
  const tcs = tbl.getElementsByTagNameNS(W_NS, "tc");
  for (let i = 0; i < tcs.length; i++) {
    const paras = tcs[i].getElementsByTagNameNS(W_NS, "p");
    let nonEmpty = 0;
    for (let j = 0; j < paras.length; j++) {
      if (getParaText(paras[j]).trim()) nonEmpty++;
    }
    if (nonEmpty > 1) return true;
  }
  return false;
}

// ── Item extraction (mirrors _extract_items in processor.py) ─────────────────

function extractItems(docXml) {
  const xmlDoc = new DOMParser().parseFromString(docXml, "text/xml");
  const bodies = xmlDoc.getElementsByTagNameNS(W_NS, "body");
  if (!bodies.length) throw new Error("No body found in document.");
  const body = bodies[0];

  const items = [];
  let prevWasHeader = false;

  for (let i = 0; i < body.childNodes.length; i++) {
    const child = body.childNodes[i];
    if (child.nodeType !== 1) continue; // skip text/comment nodes

    const localName = child.localName;

    // ── Paragraph ──────────────────────────────────────────────────────────
    if (localName === "p") {
      const text = getParaText(child);
      const stripped = text.trim();
      const style = getParaStyle(child);

      if (stripped) {
        const itemText = paraIsListItem(child) ? "-\t" + stripped : stripped;
        items.push({ text: itemText, blank: false, afterHeader: prevWasHeader, suppressSep: false });
        prevWasHeader = HEADER_STYLES.has(style);
      } else {
        // Preserve source blank paragraphs
        items.push({ text: text, blank: true, afterHeader: false, suppressSep: false });
        // Don't reset prevWasHeader on blank lines
      }

    // ── Table ───────────────────────────────────────────────────────────────
    } else if (localName === "tbl") {
      if (tableIsMultiPara(child)) {
        // Analyst-style: 1 row × N columns, each column has multiple paragraphs
        const trs = child.getElementsByTagNameNS(W_NS, "tr");
        for (let r = 0; r < trs.length; r++) {
          const tcs = trs[r].getElementsByTagNameNS(W_NS, "tc");
          for (let c = 0; c < tcs.length; c++) {
            const paras = tcs[c].getElementsByTagNameNS(W_NS, "p");
            const cellLines = [];
            for (let p = 0; p < paras.length; p++) {
              const t = getParaText(paras[p]);
              if (t.trim()) cellLines.push(t);
            }
            cellLines.forEach((line, idx) => {
              items.push({ text: line, blank: false, afterHeader: false, suppressSep: idx > 0 });
            });
            // Blank separator between analysts (also after the last one)
            items.push({ text: "", blank: true, afterHeader: false, suppressSep: false });
          }
        }
      } else {
        // Rating-style: N rows × M columns, single paragraph per cell
        const trs = child.getElementsByTagNameNS(W_NS, "tr");
        for (let r = 0; r < trs.length; r++) {
          const tcs = trs[r].getElementsByTagNameNS(W_NS, "tc");
          const rowParts = [];
          for (let c = 0; c < tcs.length; c++) {
            const paras = tcs[c].getElementsByTagNameNS(W_NS, "p");
            rowParts.push(paras[0] ? getParaText(paras[0]) : "");
          }
          const nonEmpty = rowParts.filter((p) => p.trim());
          const rowText = nonEmpty.join("\t\t").trim();
          if (rowText) {
            items.push({ text: rowText, blank: false, afterHeader: false, suppressSep: r > 0 });
          }
        }
        // Blank after the whole table
        items.push({ text: "", blank: true, afterHeader: false, suppressSep: false });
      }
      prevWasHeader = false;
    }
  }

  return items;
}

// ── Document builder ─────────────────────────────────────────────────────────

function makePlainParagraph(text) {
  return new Paragraph({
    children: text
      ? [new TextRun({ text, font: "Calibri", size: 24 })] // 24 half-points = 12pt
      : [],
    alignment: AlignmentType.JUSTIFIED,
    spacing: { before: 0, after: 0, line: 240, lineRule: "auto" },
  });
}

function buildOutputFilename(originalName) {
  const base = path.basename(originalName, path.extname(originalName)).replace(/_input$/, "");
  return `ComPrensa_${base}_plain.docx`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function processComunicado(buffer, originalName) {
  const zip = await JSZip.loadAsync(buffer);
  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) throw new Error("Invalid .docx file.");

  const docXml = await docXmlFile.async("string");
  const items = extractItems(docXml);

  if (!items.some((item) => !item.blank)) {
    throw new Error("No text content found in the uploaded document.");
  }

  const paragraphs = [];
  let prevWasContent = false;

  for (const item of items) {
    if (item.blank) {
      if (prevWasContent || paragraphs.length > 0) {
        paragraphs.push(makePlainParagraph(item.text));
      }
      prevWasContent = false;
    } else {
      if (prevWasContent && !item.afterHeader && !item.suppressSep) {
        paragraphs.push(makePlainParagraph(""));
      }
      paragraphs.push(makePlainParagraph(item.text));
      prevWasContent = true;
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 24 } },
      },
    },
    sections: [{ children: paragraphs }],
  });

  const outBuffer = await Packer.toBuffer(doc);
  return { buffer: outBuffer, filename: buildOutputFilename(originalName) };
}
