-- 011: Calendly — quando a pessoa agendou e o ID da resposta do Yay! Forms que veio no link (utm_term)
ALTER TABLE calendly_events ADD COLUMN booked_at TEXT;
ALTER TABLE calendly_events ADD COLUMN yay_response_id TEXT;
CREATE INDEX calendly_events_resposta_idx ON calendly_events (yay_response_id);
