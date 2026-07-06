import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { logger } from './logger.js';

const log = logger.forService('session-service');

export interface SessionRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatMessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  tools_json: string | null;
  citations_json: string | null;
  web_results_json: string | null;
  uploaded_files_json: string | null;
  tokens_used_json: string | null;
  model: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: number;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolsConfig?: Record<string, unknown>;
  citations?: unknown[];
  webResults?: unknown[];
  uploadedFiles?: unknown[];
  tokensUsed?: { prompt: number; completion: number; total: number };
  model?: string;
  createdAt: string;
}

export type AddMessageInput = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolsConfig?: Record<string, unknown>;
  citations?: unknown[];
  webResults?: unknown[];
  uploadedFiles?: unknown[];
  tokensUsed?: { prompt: number; completion: number; total: number };
  model?: string;
};

const MAX_TITLE_LENGTH = 60;

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
  };
}

function rowToMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as 'user' | 'assistant' | 'system',
    content: row.content,
    toolsConfig: row.tools_json ? JSON.parse(row.tools_json) : undefined,
    citations: row.citations_json ? JSON.parse(row.citations_json) : undefined,
    webResults: row.web_results_json ? JSON.parse(row.web_results_json) : undefined,
    uploadedFiles: row.uploaded_files_json ? JSON.parse(row.uploaded_files_json) : undefined,
    tokensUsed: row.tokens_used_json ? JSON.parse(row.tokens_used_json) : undefined,
    model: row.model || undefined,
    createdAt: row.created_at,
  };
}

export class SessionService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    log.info('SessionService initialized');
  }

  createSession(title?: string): Session {
    const id = uuid();
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      'INSERT INTO sessions (id, title, created_at, updated_at, message_count) VALUES (?, ?, ?, ?, 0)'
    );
    stmt.run(id, title || 'New Chat', now, now);
    log.info('Session created', { sessionId: id, title: title || 'New Chat' });
    return this.getSession(id)!;
  }

  listSessions(): Session[] {
    const rows = this.db.prepare(
      'SELECT * FROM sessions ORDER BY updated_at DESC'
    ).all() as SessionRow[];
    log.debug('Listed sessions', { count: rows.length });
    return rows.map(rowToSession);
  }

  getSession(id: string): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
    if (!row) return null;
    return rowToSession(row);
  }

  updateSession(id: string, data: { title?: string }): Session | null {
    if (data.title !== undefined) {
      const now = new Date().toISOString();
      this.db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(data.title, now, id);
      log.info('Session updated', { sessionId: id, title: data.title });
    }
    return this.getSession(id);
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    log.info('Session deleted', { sessionId: id });
  }

  addMessage(sessionId: string, input: AddMessageInput): ChatMessage {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO chat_messages (session_id, role, content, tools_json, citations_json, web_results_json, uploaded_files_json, tokens_used_json, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      sessionId,
      input.role,
      input.content,
      input.toolsConfig ? JSON.stringify(input.toolsConfig) : null,
      input.citations ? JSON.stringify(input.citations) : null,
      input.webResults ? JSON.stringify(input.webResults) : null,
      input.uploadedFiles ? JSON.stringify(input.uploadedFiles) : null,
      input.tokensUsed ? JSON.stringify(input.tokensUsed) : null,
      input.model || null,
      now,
    );
    this.db.prepare('UPDATE sessions SET updated_at = ?, message_count = message_count + 1 WHERE id = ?').run(now, sessionId);
    log.debug('Message added', { sessionId, role: input.role, messageId: result.lastInsertRowid });
    const row = this.db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(result.lastInsertRowid) as ChatMessageRow;
    return rowToMessage(row);
  }

  getMessages(sessionId: string): ChatMessage[] {
    const rows = this.db.prepare(
      'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC'
    ).all(sessionId) as ChatMessageRow[];
    log.debug('Retrieved messages', { sessionId, count: rows.length });
    return rows.map(rowToMessage);
  }

  setAutoTitle(sessionId: string, firstMessage: string): void {
    const trimmed = firstMessage.trim();
    if (!trimmed) return;
    const title = trimmed.length > MAX_TITLE_LENGTH
      ? trimmed.substring(0, MAX_TITLE_LENGTH) + '...'
      : trimmed;
    this.updateSession(sessionId, { title });
    log.info('Session auto-titled', { sessionId, title });
  }
}
