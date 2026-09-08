-- 006: chat stream resilience (v1.4.5)
-- Adds a client-generated turn id so a retried turn (after a dropped stream)
-- replaces the previous attempt instead of duplicating the user message.

alter table messages add column if not exists client_turn_id uuid;

create unique index if not exists messages_user_turn_uniq
  on messages(user_id, client_turn_id)
  where client_turn_id is not null;

create index if not exists messages_conversation_turn_idx
  on messages(conversation_id, client_turn_id)
  where client_turn_id is not null;
