-- audit_log ya guarda user_nombre/user_rol como texto aparte, así que el
-- registro de auditoría no pierde información si el usuario se borra —
-- solo dejamos de poder hacer JOIN a un usuario que ya no existe.
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_user_id_fkey;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
