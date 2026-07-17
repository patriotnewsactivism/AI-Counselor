import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
export const MAX_EXTRACTED_CHARS = 300_000;

export const SUPPORTED_DOCUMENT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function isSupportedDocumentType(mimeType: string, fileName: string): boolean {
  if (SUPPORTED_DOCUMENT_TYPES.has(mimeType)) return true;
  const extension = fileName.toLowerCase().split(".").pop();
  return extension === "txt" || extension === "md" || extension === "csv" || extension === "pdf" || extension === "docx";
}

export async function extractDocumentText(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<string> {
  if (buffer.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error("Documents must be 15 MB or smaller.");
  }

  const extension = fileName.toLowerCase().split(".").pop();
  let text: string;

  if (mimeType === "application/pdf" || extension === "pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      text = result.text;
    } finally {
      await parser.destroy();
    }
  } else if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === "docx"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else {
    text = buffer.toString("utf8");
  }

  const normalized = text.replace(/\0/g, "").replace(/\r\n/g, "\n").trim();
  if (!normalized) throw new Error("That document did not contain readable text.");
  if (normalized.length > MAX_EXTRACTED_CHARS) {
    throw new Error("That document contains more than 300,000 readable characters. Please upload a shorter document.");
  }
  return normalized;
}
