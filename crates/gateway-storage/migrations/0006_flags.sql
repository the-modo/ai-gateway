-- Guardrail / Content Shield activations recorded per request,
-- e.g. "guardrail:Profanity Filter,shield:Email Addresses"
ALTER TABLE requests ADD COLUMN flags TEXT;
