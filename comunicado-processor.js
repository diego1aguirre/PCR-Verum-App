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

// Styles that act as section headers — no empty separator is inserted
// between them and the immediately-following sub-item paragraph.
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
  let prevWasHeader = false; // tracks whether the last non-blank body para was a header style

  for (let i = 0; i < body.childNodes.length; i++) {
    const child = body.childNodes[i];
    if (child.nodeType !== 1) continue; // skip text/comment nodes

    const localName = child.localName;

    // ── Body paragraph ────────────────────────────────────────────────
    if (localName === "p") {
      const text = getParaText(child);
      const stripped = text.trim();
      const style = getParaStyle(child);

      if (stripped) {
        // List items (numPr) get a dash-tab prefix matching the original format
        const itemText = paraIsListItem(child) ? "-\t" + stripped : stripped;
        items.push({ text: itemText, blank: false, afterHeader: prevWasHeader, suppressSep: false });
        prevWasHeader = HEADER_STYLES.has(style);
      } else {
        // Preserve source empty paragraphs (they carry intentional spacing)
        items.push({ text: text, blank: true, afterHeader: false, suppressSep: false });
        // Don't reset prevWasHeader on blank lines
      }

    // ── Table ─────────────────────────────────────────────────────────
    } else if (localName === "tbl") {
      if (tableIsMultiPara(child)) {
        // Analyst-style table: 1 row × N columns, each column has
        // multiple paragraphs (name / title / phone / email).
        // Output: each paragraph in each cell on its own line,
        // with a blank separator between cells (analysts).
        // suppressSep=true on lines 2+ within a cell so the
        // auto-separator logic doesn't insert blanks inside the block.
        const trs = child.getElementsByTagNameNS(W_NS, "tr");
        for (let r = 0; r < trs.length; r++) {
          const tcs = trs[r].getElementsByTagNameNS(W_NS, "tc");
          for (let c = 0; c < tcs.length; c++) {
            const paras = tcs[c].getElementsByTagNameNS(W_NS, "p");
            const cellLines = [];
            for (let p = 0; p < paras.length; p++) {
              const t = getParaText(paras[p]); // preserve leading spaces intentionally
              if (t.trim()) cellLines.push(t);
            }
            cellLines.forEach((line, idx) => {
              items.push({ text: line, blank: false, afterHeader: false, suppressSep: idx > 0 });
            });
            // Blank between analysts (also acts as trailing blank after last)
            items.push({ text: "", blank: true, afterHeader: false, suppressSep: false });
          }
        }
      } else {
        // Rating-style table: N rows × M columns, single paragraph per cell.
        // Join cells per row WITHOUT stripping individual cells (preserves
        // intentional whitespace like '   -'), then strip the whole row.
        const trs = child.getElementsByTagNameNS(W_NS, "tr");
        for (let r = 0; r < trs.length; r++) {
          const tcs = trs[r].getElementsByTagNameNS(W_NS, "tc");
          const rowParts = [];
          for (let c = 0; c < tcs.length; c++) {
            const paras = tcs[c].getElementsByTagNameNS(W_NS, "p");
            rowParts.push(paras[0] ? getParaText(paras[0]) : "");
          }
          // Join non-empty cells with double-tab so columns are visually
          // separated (matches the original ComPrensa table layout).
          const nonEmpty = rowParts.filter((p) => p.trim());
          const rowText = nonEmpty.join("\t\t").trim();
          if (rowText) {
            // First row: allow auto-separator before it (separates from preceding content).
            // Subsequent rows: suppressSep keeps them consecutive with no blank between.
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
      ? [new TextRun({ text, font: "Aptos", size: 24 })] // 24 half-points = 12pt
      : [],
    alignment: AlignmentType.JUSTIFIED,
    spacing: { before: 0, after: 0, line: 240, lineRule: "auto" },
  });
}

// Post-process the generated .docx buffer to inject the w:asciiTheme /
// w:hAnsiTheme attributes that python-docx writes explicitly:
//   rFonts.set(qn('w:asciiTheme'), 'minorHAnsi')
//   rFonts.set(qn('w:hAnsiTheme'), 'minorHAnsi')
// The 'docx' npm package has no API for these, so we add them directly
// to the XML after Packer.toBuffer() produces the zip.
async function injectAptosThemeAttributes(docxBuffer) {
  const zip = await JSZip.loadAsync(docxBuffer);

  for (const filePath of ["word/document.xml", "word/styles.xml"]) {
    const entry = zip.file(filePath);
    if (!entry) continue;

    let xml = await entry.async("string");

    // Find every self-closing <w:rFonts .../> that already carries
    // w:ascii="Aptos" and add the theme attributes if they are absent.
    xml = xml.replace(/<w:rFonts([^/]*?)\/>/g, (match, attrs) => {
      if (!attrs.includes('w:ascii="Aptos"')) return match;
      let a = attrs;
      if (!a.includes("w:asciiTheme")) a += ' w:asciiTheme="minorHAnsi"';
      if (!a.includes("w:hAnsiTheme")) a += ' w:hAnsiTheme="minorHAnsi"';
      return `<w:rFonts${a}/>`;
    });

    zip.file(filePath, xml);
  }

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
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
  let prevWasContent = false; // last written item was a non-blank paragraph

  for (const item of items) {
    if (item.blank) {
      // Write source blank lines through only if we've already started writing
      if (prevWasContent || paragraphs.length > 0) {
        paragraphs.push(makePlainParagraph(item.text));
      }
      prevWasContent = false;
    } else {
      // Before each content paragraph, insert an empty separator UNLESS:
      //   - nothing written yet (first paragraph)
      //   - the last thing written was already a blank
      //   - this paragraph immediately follows a section header
      //   - suppress_sep is set (consecutive lines within a table cell)
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
        // Mirror: out_doc.styles['Normal'].font.name = 'Aptos'
        //         out_doc.styles['Normal'].font.size = Pt(12)
        document: { run: { font: "Aptos", size: 24 } },
      },
    },
    sections: [{ children: paragraphs }],
  });

  const rawBuffer = await Packer.toBuffer(doc);

  // Inject w:asciiTheme / w:hAnsiTheme into every w:rFonts element —
  // mirrors the explicit XML manipulation python-docx performs.
  const outBuffer = await injectAptosThemeAttributes(rawBuffer);

  return { buffer: outBuffer, filename: buildOutputFilename(originalName) };
}
