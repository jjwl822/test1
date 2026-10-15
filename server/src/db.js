import { DatabaseSync } from 'node:sqlite';

export function openDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name  TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tokens (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      sender_id       INTEGER NOT NULL REFERENCES users(id),
      kind            TEXT NOT NULL CHECK (kind IN ('text', 'image')),
      text            TEXT,
      image           TEXT,
      created_at      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id);

    CREATE TABLE IF NOT EXISTS posts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id  INTEGER NOT NULL REFERENCES users(id),
      text       TEXT NOT NULL DEFAULT '',
      image      TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id  INTEGER NOT NULL REFERENCES users(id),
      text       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, id);

    CREATE TABLE IF NOT EXISTS reactions (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      kind    TEXT NOT NULL CHECK (kind IN ('heart', 'like', 'dislike')),
      PRIMARY KEY (post_id, user_id, kind)
    );

    -- Photos and videos uploaded for stories. A row with post_id NULL is an upload that has
    -- not been attached to a post yet. position is NULL for video poster frames.
    CREATE TABLE IF NOT EXISTS media (
      name        TEXT PRIMARY KEY,
      uploader_id INTEGER NOT NULL REFERENCES users(id),
      kind        TEXT NOT NULL CHECK (kind IN ('image', 'video')),
      post_id     INTEGER REFERENCES posts(id) ON DELETE CASCADE,
      position    INTEGER,
      poster      TEXT,
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_media_post ON media(post_id, position);

    -- Stories from before multi-photo support kept their single photo in posts.image.
    INSERT OR IGNORE INTO media (name, uploader_id, kind, post_id, position, created_at)
      SELECT image, author_id, 'image', id, 0, created_at FROM posts WHERE image IS NOT NULL;
  `);
  return db;
}
