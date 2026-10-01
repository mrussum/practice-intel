/**
 * Turns an uploaded file into plain text. The file type comes from the
 * extension and is confirmed by magic bytes. Browsers report inconsistent MIME
 * types for .md/.docx, so the declared type is not trusted either way.
 */
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export const SUPPORTED_EXTENSIONS = ["pdf", "docx", "txt", "md"] as const;
export type FileType = (typeof SUPPORTED_EXTENSIONS)[number];

export class ParseError extends Error {}

export function detectFileType(filename: string, bytes: Buffer): FileType {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new ParseError(`Unsupported file type ".${ext}". Upload a PDF, DOCX, TXT or MD file.`);
  }
  const type = ext as FileType;
  const head = bytes.subarray(0, 5).toString("latin1");
  if (type === "pdf" && !head.startsWith("%PDF-")) {
    throw new ParseError("This file has a .pdf extension but is not a valid PDF.");
  }
  if (type === "docx" && !head.startsWith("PK\u0003\u0004")) {
    throw new ParseError("This file has a .docx extension but is not a valid Word document.");
  }
  if ((type === "txt" || type === "md") && bytes.includes(0)) {
    throw new ParseError("This text file contains binary data. Save it as plain UTF-8 text and try again.");
  }
  return type;
}

/** Collapses the whitespace noise PDF/DOCX extraction produces, but keeps paragraph breaks. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/[ ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function parseDocument(filename: string, bytes: Buffer): Promise<string> {
  const type = detectFileType(filename, bytes);
  let text: string;
  try {
    if (type === "pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      text = (await extractText(pdf, { mergePages: true })).text;
    } else if (type === "docx") {
      text = (await mammoth.extractRawText({ buffer: bytes })).value;
    } else {
      text = bytes.toString("utf8");
    }
  } catch {
    throw new ParseError(`Could not read "${filename}". The file may be corrupted or password-protected.`);
  }
  const normalized = normalizeText(text);
  if (normalized.length < 20) {
    throw new ParseError(`No readable text found in "${filename}". If it is a scanned PDF, export it with selectable text.`);
  }
  return normalized;
}
