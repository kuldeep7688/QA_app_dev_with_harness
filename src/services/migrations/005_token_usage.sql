-- Migration 005: Add token usage columns to qa_history
-- Tracks prompt/completion/total tokens and model name per Q&A exchange

ALTER TABLE qa_history ADD COLUMN model_used TEXT;
ALTER TABLE qa_history ADD COLUMN prompt_tokens INTEGER;
ALTER TABLE qa_history ADD COLUMN completion_tokens INTEGER;
ALTER TABLE qa_history ADD COLUMN total_tokens INTEGER;
