CREATE TABLE notas (
  id SERIAL PRIMARY KEY,
  autor_id INTEGER NOT NULL REFERENCES users(id),
  mensaje TEXT NOT NULL,
  para_todos BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE notas_destinatarios (
  id SERIAL PRIMARY KEY,
  nota_id INTEGER NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  leido BOOLEAN NOT NULL DEFAULT false,
  atendido BOOLEAN NOT NULL DEFAULT false,
  atendido_at TIMESTAMP,
  UNIQUE (nota_id, user_id)
);

CREATE INDEX idx_notas_destinatarios_user ON notas_destinatarios(user_id);
CREATE INDEX idx_notas_autor ON notas(autor_id);
