import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

const log = logger.forService('FileExtractionService');

export type SupportedFileType = 'txt' | 'md' | 'pdf' | 'docx';

const SUPPORTED_EXTENSIONS: SupportedFileType[] = ['txt', 'md', 'pdf', 'docx'];

export function isSupportedFileType(ext: string): ext is SupportedFileType {
  return SUPPORTED_EXTENSIONS.includes(ext as SupportedFileType);
}

async function extractPdfText(filePath: string): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const dataBuffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: dataBuffer });
  const result = await parser.getText();
  await parser.destroy();
  return result.text;
}

async function extractDocxText(filePath: string): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

function extractTextFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

export interface ExtractionResult {
  content: string;
  ext: SupportedFileType;
}

export async function extractText(filePath: string): Promise<ExtractionResult> {
  const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'txt';

  if (!isSupportedFileType(ext)) {
    const msg = `Unsupported file type: .${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`;
    log.error(msg, { filePath, ext });
    throw new Error(msg);
  }

  log.debug('Extracting text from file', { filePath, ext });

  let content: string;
  if (ext === 'pdf') {
    content = await extractPdfText(filePath);
  } else if (ext === 'docx') {
    content = await extractDocxText(filePath);
  } else {
    content = extractTextFile(filePath);
  }

  log.debug('Text extraction complete', { filePath, ext, contentLength: content.length });
  return { content, ext };
}

export async function extractionFromBuffer(
  buffer: Buffer,
  ext: string,
): Promise<ExtractionResult> {
  if (!isSupportedFileType(ext)) {
    const msg = `Unsupported file type: .${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`;
    log.error(msg, { ext });
    throw new Error(msg);
  }

  let content: string;
  if (ext === 'pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    content = result.text;
  } else if (ext === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    content = result.value;
  } else {
    content = buffer.toString('utf-8');
  }

  return { content, ext };
}
