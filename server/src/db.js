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
      kind            TEXT NOT NULL CHECK (kind IN ('text', 'image', 'poll')),
      text            TEXT,
      image           TEXT,
      reply_to        INTEGER,
      deleted         INTEGER NOT NULL DEFAULT 0,
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
  migrate(db);
  db.exec(`
    -- Last message each person has read in each conversation (read receipts and unread counts).
    CREATE TABLE IF NOT EXISTS reads (
      conversation_id TEXT NOT NULL,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_id    INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, user_id)
    );

    -- One emoji per person per message.
    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji      TEXT NOT NULL,
      PRIMARY KEY (message_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS polls (
      message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      question   TEXT NOT NULL,
      multiple   INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS poll_options (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES polls(message_id) ON DELETE CASCADE,
      text       TEXT NOT NULL,
      position   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS poll_votes (
      option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
      user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (option_id, user_id)
    );

    -- Family calendar. yearly = birthdays and anniversaries that repeat every year.
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      date       TEXT NOT NULL,
      time       TEXT,
      note       TEXT NOT NULL DEFAULT '',
      yearly     INTEGER NOT NULL DEFAULT 0,
      author_id  INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL
    );

    -- Remembers which reminder notifications were already sent, so each goes out once.
    CREATE TABLE IF NOT EXISTS reminders_sent (
      key     TEXT PRIMARY KEY,
      sent_at INTEGER NOT NULL
    );

    -- Shared shopping list and to-do list.
    CREATE TABLE IF NOT EXISTS list_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      list       TEXT NOT NULL CHECK (list IN ('shopping', 'todo', 'homework')),
      text       TEXT NOT NULL,
      done       INTEGER NOT NULL DEFAULT 0,
      author_id  INTEGER NOT NULL REFERENCES users(id),
      done_by    INTEGER REFERENCES users(id),
      created_at INTEGER NOT NULL,
      done_at    INTEGER,
      -- 📚 homework: due date, who it's for, and the chat notice it came from
      due         TEXT,
      assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      source_job  INTEGER,
      dedupe      TEXT
    );

    -- Chat messages already turned into homework items (job = first message of the notice).
    CREATE TABLE IF NOT EXISTS homework_sources (
      message_id INTEGER PRIMARY KEY,
      job        INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

/** Brings databases created by earlier versions up to the current schema. */
function migrate(db) {
  const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!columns('posts').includes('edited_at')) db.exec('ALTER TABLE posts ADD COLUMN edited_at INTEGER');
  if (!columns('users').includes('avatar')) db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
  if (!columns('users').includes('color')) db.exec('ALTER TABLE users ADD COLUMN color TEXT');

  // SQLite can't change a CHECK constraint, so the messages table is rebuilt to allow polls,
  // replies and deleted messages.
  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'").get();
  if (!sql.includes("'poll'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE messages_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        sender_id       INTEGER NOT NULL REFERENCES users(id),
        kind            TEXT NOT NULL CHECK (kind IN ('text', 'image', 'poll')),
        text            TEXT,
        image           TEXT,
        reply_to        INTEGER,
        deleted         INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL
      );
      INSERT INTO messages_new (id, conversation_id, sender_id, kind, text, image, created_at)
        SELECT id, conversation_id, sender_id, kind, text, image, created_at FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id);
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }

  // Same for list_items, to add the 📚 homework list.
  const lists = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'list_items'").get();
  if (lists && !lists.sql.includes("'homework'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE list_items_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        list        TEXT NOT NULL CHECK (list IN ('shopping', 'todo', 'homework')),
        text        TEXT NOT NULL,
        done        INTEGER NOT NULL DEFAULT 0,
        author_id   INTEGER NOT NULL REFERENCES users(id),
        done_by     INTEGER REFERENCES users(id),
        created_at  INTEGER NOT NULL,
        done_at     INTEGER,
        due         TEXT,
        assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        source_job  INTEGER,
        dedupe      TEXT
      );
      INSERT INTO list_items_new (id, list, text, done, author_id, done_by, created_at, done_at)
        SELECT id, list, text, done, author_id, done_by, created_at, done_at FROM list_items;
      DROP TABLE list_items;
      ALTER TABLE list_items_new RENAME TO list_items;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }
}
