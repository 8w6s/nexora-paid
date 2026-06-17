-- TOTP hardening: replay-protection counter + scrypt-hashed backup codes.
--
-- The existing totp_secret column is reused; values written from this point
-- on are AES-256-GCM ciphertext (the encryptedText custom type wraps writes
-- via encrypt() and reads via decrypt() — an unencrypted legacy value will
-- pass through decrypt() unchanged so any pre-launch row keeps working).
--
-- last_totp_counter prevents the "submit same code twice within 30s" replay:
-- verifyCode() now returns the matched RFC-6238 step and the caller persists
-- max(prev, matched) here. New rows start at -1 so the first verification
-- always succeeds.
--
-- totp_backup_codes is a JSON array of "salt:hash" strings (scrypt N=16384,
-- r=8, p=1, 32-byte output). NULL when no backup codes are enrolled.
ALTER TABLE users ADD COLUMN last_totp_counter INTEGER NOT NULL DEFAULT -1;
ALTER TABLE users ADD COLUMN totp_backup_codes TEXT;