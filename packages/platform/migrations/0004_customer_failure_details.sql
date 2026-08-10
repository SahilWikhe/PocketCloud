ALTER TABLE deployments
  ADD COLUMN error_retryable boolean,
  ADD COLUMN error_retry_after_seconds integer CHECK (
    error_retry_after_seconds IS NULL OR error_retry_after_seconds >= 0
  );
