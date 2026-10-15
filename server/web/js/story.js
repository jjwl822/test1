import { useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { api, compressImage, isVideoFile, MAX_VIDEO_BYTES, onLive, videoPoster } from './api.js';
import { ago, Avatar, avatarUrlOf, Confirm, go, html, Icon, MediaViewer, Sheet, Spinner, TopBar, useBackToClose, useStore } from './ui.js';

const MAX_MEDIA = 10;
const NEW = 'new';

/** Story tab: Instagram-profile-style grid; /post/:id opens a post. */
export function StoryScreen({ me, postId }) {
  useStore();
  const [posts, setPosts] = useState([]);
  const [memories, setMemories] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState(null);
  const [editor, setEditor] = useState(null); // NEW or a post being edited

  const upsert = (post) => {
    setPosts((list) => (list.some((p) => p.id === post.id) ? list.map((p) => (p.id === post.id ? post : p)) : [post, ...list].sort((a, b) => b.id - a.id)));
    setMemories((list) => list.map((p) => (p.id === post.id ? post : p)));
  };
  const remove = (id) => {
    setPosts((list) => list.filter((p) => p.id !== id));
    setMemories((list) => list.filter((p) => p.id !== id));
  };
  const loadSummary = () => api.feedSummary().then(setSummary).catch(() => {});

  async function refresh() {
    try {
      const list = await api.posts();
      setPosts(list);
      setHasOlder(list.length >= 20);
      setError(null);
      loadSummary();
      api.memories().then(setMemories).catch(() => {});
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    return onLive(['post', 'comment', 'feed', 'connected'], async (data, type) => {
      if (type === 'connected') return refresh();
      try {
        upsert(await api.post(data.postId));
        if (type === 'post') loadSummary();
      } catch (e) {
        if (e.status === 404) {
          remove(data.postId);
          loadSummary();
        }
      }
    });
  }, []);

  const find = (id) => posts.find((p) => p.id === id) ?? memories.find((p) => p.id === id);
  const open = postId ? find(postId) : null;

  // A post opened from a notification may not be loaded yet.
  useEffect(() => {
    if (postId && !open && !loading) api.post(postId).then(upsert).catch(() => go('/story'));
  }, [postId, loading]);

  const editing = editor && editor !== NEW ? find(editor) : null;
  const editorView =
    editor &&
    html`<${PostEditor}
      editing=${editing}
      onClose=${() => setEditor(null)}
      onSaved=${(post) => {
        upsert(post);
        loadSummary();
        setEditor(null);
        go(`/post/${post.id}`);
      }}
    />`;

  if (postId) {
    if (!open) return html`<${TopBar} title="게시물" small onBack=${() => go('/story')} /><${Spinner} />`;
    return html`<${PostDetail}
        post=${open}
        me=${me}
        onBack=${() => go('/story')}
        onChanged=${upsert}
        onEdit=${() => setEditor(open.id)}
        onDeleted=${() => {
          remove(open.id);
          loadSummary();
          go('/story');
        }}
      />${editorView}`;
  }

  async function loadOlder() {
    const older = await api.posts(posts[posts.length - 1]?.id).catch(() => []);
    setHasOlder(older.length >= 20);
    setPosts((list) => [...list, ...older.filter((p) => !list.some((x) => x.id === p.id))]);
  }

  return html`<${TopBar} title="가족 스토리">
      <button class="icon-btn" onClick=${() => setEditor(NEW)} aria-label="새 게시물"><${Icon} name="plusSquare" /></button>
    <//>
    <div
      class="scroll"
      onScroll=${(e) => {
        const el = e.currentTarget;
        if (hasOlder && el.scrollHeight - el.scrollTop - el.clientHeight < 300) {
          setHasOlder(false);
          loadOlder();
        }
      }}
    >
      <div class="profile-head">
        <${Avatar} name="우리 가족" size=${86} ring group />
        <div class="stats">
          <div><b>${summary?.posts ?? posts.length}</b>게시물</div>
          <div><b>${summary?.members ?? '-'}</b>가족</div>
        </div>
      </div>
      <div style="padding:0 16px"><div class="bold">우리 가족</div><div>우리끼리 나누는 사진과 이야기</div></div>
      <div style="padding:12px 16px"><button class="btn block" onClick=${() => setEditor(NEW)}>새 게시물 올리기</button></div>
      ${memories.length > 0 &&
      html`<div class="bold" style="padding:4px 16px 8px">✨ 1년 전 오늘</div>
        <div class="memories">
          ${memories.map((p) => {
            const years = new Date().getFullYear() - new Date(p.createdAt).getFullYear();
            const cover = p.media[0];
            return html`<button class="memory" onClick=${() => go(`/post/${p.id}`)}>
              ${cover ? html`<img src=${cover.posterUrl || cover.url} alt="" />` : html`<div class="small" style="padding:10px">${p.text}</div>`}
              <span class="years">${years}년 전</span>
            </button>`;
          })}
        </div>`}
      <div style="border-top:0.5px solid var(--line);padding:10px 0" class="center"><${Icon} name="grid" /></div>
      ${error && html`<div class="error">${error}</div>`}
      ${loading && posts.length === 0 && html`<${Spinner} />`}
      ${!loading && posts.length === 0 && html`<div class="empty">첫 게시물을 올려보세요.<br />가족과 나누고 싶은 사진과 이야기를 올려보세요.</div>`}
      <div class="grid">${posts.map((p) => html`<${Tile} key=${p.id} post=${p} />`)}</div>
    </div>
    ${editorView}`;
}

function Tile({ post }) {
  const cover = post.media[0];
  if (!cover) {
    return html`<button class="tile text" onClick=${() => go(`/post/${post.id}`)}><span>${post.text}</span></button>`;
  }
  const mark = post.media.length > 1 ? 'layers' : cover.kind === 'video' ? 'play' : null;
  return html`<button class="tile" onClick=${() => go(`/post/${post.id}`)}>
    ${cover.kind === 'video' && !cover.posterUrl
      ? html`<video src=${`${cover.url}#t=0.1`} muted playsinline preload="metadata"></video>`
      : html`<img src=${cover.posterUrl || cover.url} alt="" loading="lazy" />`}
    ${mark && html`<span class="mark"><${Icon} name=${mark} size="sm" filled=${mark === 'play'} /></span>`}
  </button>`;
}

// ---- Post page ----------------------------------------------------------------------------

function PostDetail({ post, me, onBack, onChanged, onEdit, onDeleted }) {
  const [viewing, setViewing] = useState(null);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [comments, setComments] = useState(false);
  const [error, setError] = useState(null);
  const mine = post.authorId === me.id;
  const my = post.myReactions;
  const react = (kind) => api.reactPost(post.id, kind).then(onChanged).catch((e) => setError(e.message));
  const r = post.reactions;
  const counts = [r.heart && `하트 ${r.heart}개`, r.like && `좋아요 ${r.like}개`, r.dislike && `싫어요 ${r.dislike}개`].filter(Boolean);

  return html`<${TopBar} title="게시물" small onBack=${onBack} />
    <div class="scroll">
      <div class="row" style="padding:8px 8px 8px 12px">
        <${Avatar} name=${post.authorName} url=${avatarUrlOf(post.authorId)} size=${34} ring />
        <div class="grow bold">${post.authorName}</div>
        ${mine && html`<button class="icon-btn" onClick=${() => setMenu(true)} aria-label="더보기"><${Icon} name="more" /></button>`}
      </div>
      ${post.media.length > 0 && html`<${Carousel} media=${post.media} onOpen=${setViewing} />`}
      <div class="actions-row">
        <button class="icon-btn" onClick=${() => react('heart')} aria-label="하트">
          <${Icon} name="heart" filled=${my.includes('heart')} color=${my.includes('heart') ? 'var(--red)' : null} />
        </button>
        <button class="icon-btn" onClick=${() => setComments(true)} aria-label="댓글"><${Icon} name="comment" /></button>
        <span class="grow"></span>
        <button class="icon-btn" onClick=${() => react('like')} aria-label="좋아요">
          <${Icon} name="thumbUp" filled=${my.includes('like')} color=${my.includes('like') ? 'var(--blue)' : null} />
        </button>
        <button class="icon-btn" onClick=${() => react('dislike')} aria-label="싫어요">
          <${Icon} name="thumbDown" filled=${my.includes('dislike')} />
        </button>
      </div>
      <div class=${`post-text ${counts.length ? 'bold' : 'muted'}`}>${counts.length ? counts.join(' · ') : '가장 먼저 하트를 눌러보세요'}</div>
      ${post.text && html`<div class="post-text"><b>${post.authorName}</b>  ${post.text}</div>`}
      <button class="post-text muted" onClick=${() => setComments(true)}>
        ${post.commentCount > 0 ? `댓글 ${post.commentCount}개 모두 보기` : '댓글 달기...'}
      </button>
      <div class="post-text tiny muted" style="padding-bottom:28px">${ago(post.createdAt)}${post.editedAt ? ' · 수정됨' : ''}</div>
      ${error && html`<div class="error">${error}</div>`}
    </div>
    ${menu &&
    html`<${Sheet} onClose=${() => setMenu(false)}>
      <button class="sheet-item" onClick=${() => { setMenu(false); onEdit(); }}><${Icon} name="edit" /> 수정</button>
      <button class="sheet-item danger" onClick=${() => { setMenu(false); setConfirmDelete(true); }}><${Icon} name="trash" /> 삭제</button>
    <//>`}
    ${confirmDelete &&
    html`<${Confirm}
      title="게시물을 삭제할까요?"
      text="댓글과 반응도 함께 삭제되며 되돌릴 수 없어요."
      onClose=${() => setConfirmDelete(false)}
      onConfirm=${() => api.deletePost(post.id).then(onDeleted).catch((e) => { setConfirmDelete(false); setError(e.message); })}
    />`}
    ${comments && html`<${Comments} post=${post} me=${me} onClose=${() => setComments(false)} />`}
    ${viewing !== null && html`<${MediaViewer} items=${post.media} start=${viewing} onClose=${() => setViewing(null)} />`}`;
}

function Carousel({ media, onOpen }) {
  const [index, setIndex] = useState(0);
  return html`<div class="carousel">
      <div class="track" onScroll=${(e) => setIndex(Math.round(e.target.scrollLeft / e.target.clientWidth))}>
        ${media.map(
          (m, i) => html`<button class="slide" onClick=${() => onOpen(i)}>
            ${m.kind === 'video' && !m.posterUrl
              ? html`<video src=${`${m.url}#t=0.1`} muted playsinline preload="metadata"></video>`
              : html`<img src=${m.posterUrl || m.url} alt="" />`}
            ${m.kind === 'video' && html`<span class="play"><${Icon} name="play" filled /></span>`}
          </button>`,
        )}
      </div>
      ${media.length > 1 && html`<span class="count">${index + 1}/${media.length}</span>`}
    </div>
    ${media.length > 1 && html`<div class="dots">${media.map((_, i) => html`<i class=${i === index ? 'on' : ''}></i>`)}</div>`}`;
}

function Comments({ post, me, onClose }) {
  const [list, setList] = useState(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);
  const load = () => api.comments(post.id).then(setList).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    return onLive(['comment', 'feed'], (data) => data.postId === post.id && load());
  }, [post.id]);
  async function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await api.addComment(post.id, text).catch((e) => setError(e.message));
    load();
  }
  return html`<${Sheet} title="댓글" onClose=${onClose}>
    <div class="scroll" style="border-top:0.5px solid var(--line);min-height:160px">
      ${list === null && html`<${Spinner} />`}
      ${list?.length === 0 && html`<div class="empty"><div class="bold" style="color:var(--fg)">아직 댓글이 없습니다</div>댓글을 남겨보세요.</div>`}
      ${list?.map(
        (c) => html`<div class="comment">
          <${Avatar} name=${c.authorName} url=${avatarUrlOf(c.authorId)} size=${32} />
          <div class="grow">
            <div><b class="small">${c.authorName}</b> <span class="tiny muted">${ago(c.createdAt)}</span></div>
            <div style="white-space:pre-wrap">${c.text}</div>
            ${c.authorId === me.id &&
            html`<button class="tiny muted bold" style="padding:4px 0" onClick=${() => api.deleteComment(c.id).then(load)}>삭제</button>`}
          </div>
        </div>`,
      )}
    </div>
    ${error && html`<div class="error">${error}</div>`}
    <div class="row" style="padding:8px 12px;border-top:0.5px solid var(--line)">
      <${Avatar} name=${me.displayName} url=${me.avatarUrl} size=${34} />
      <input
        class="pill-input"
        placeholder=${`${me.displayName}(으)로 댓글 달기...`}
        value=${draft}
        onInput=${(e) => setDraft(e.target.value)}
        onKeyDown=${(e) => e.key === 'Enter' && !e.isComposing && send()}
      />
      <button class="link" disabled=${!draft.trim()} onClick=${send}>게시</button>
    </div>
  <//>`;
}

// ---- New post / edit ------------------------------------------------------------------------

function PostEditor({ editing, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  useBackToClose(() => !busy && onClose());
  const [text, setText] = useState(editing?.text ?? '');
  // Existing media stays as is; picked files are shrunk and uploaded on save.
  const [drafts, setDrafts] = useState(() => (editing?.media ?? []).map((m) => ({ key: m.name, existing: m })));
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const input = useRef(null);

  useEffect(() => () => drafts.forEach((d) => d.previewUrl && URL.revokeObjectURL(d.previewUrl)), []);

  function pick(files) {
    const room = MAX_MEDIA - drafts.length;
    const added = [];
    for (const file of [...files]) {
      if (isVideoFile(file) && !['video/mp4', 'video/quicktime'].includes(file.type)) {
        setError('이 동영상 형식은 올릴 수 없어요. (mp4, mov만 가능)');
        continue;
      }
      if (isVideoFile(file) && file.size > MAX_VIDEO_BYTES) {
        setError('100MB가 넘는 동영상은 올릴 수 없어요. 더 짧게 잘라서 올려주세요.');
        continue;
      }
      added.push({ key: `${file.name}-${file.size}-${Math.random()}`, file, previewUrl: URL.createObjectURL(file), video: isVideoFile(file) });
    }
    if (added.length > room) setError(`사진과 동영상은 ${MAX_MEDIA}개까지 올릴 수 있어요.`);
    setDrafts([...drafts, ...added.slice(0, room)]);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const locals = drafts.filter((d) => d.file);
      let done = 0;
      const media = [];
      for (const d of drafts) {
        if (d.existing) {
          media.push({ name: d.existing.name });
          continue;
        }
        const step = `${++done}/${locals.length}`;
        if (d.video) {
          setProgress(`동영상 준비 중 ${step}`);
          const poster = await videoPoster(d.file);
          const posterName = poster ? (await api.uploadMedia(poster)).name : undefined;
          setProgress(`동영상 올리는 중 ${step} (${Math.round(d.file.size / 1024 / 1024)}MB)`);
          media.push({ name: (await api.uploadMedia(d.file)).name, poster: posterName });
        } else {
          setProgress(`사진 줄이는 중 ${step}`);
          const jpeg = await compressImage(d.file);
          setProgress(`사진 올리는 중 ${step}`);
          media.push({ name: (await api.uploadMedia(jpeg)).name });
        }
      }
      setProgress(editing ? '저장하는 중' : '올리는 중');
      const post = editing ? await api.updatePost(editing.id, text.trim(), media) : await api.createPost(text.trim(), media);
      onSaved(post);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return html`<div class="viewer" style="background:var(--bg);color:var(--fg)">
    <header class="topbar">
      <button class="icon-btn" onClick=${onClose} disabled=${busy} aria-label="닫기"><${Icon} name="close" /></button>
      <h1 class="small">${editing ? '정보 수정' : '새 게시물'}</h1>
      ${busy
        ? html`<div class="icon-btn"><div class="spinner" style="width:20px;height:20px"></div></div>`
        : html`<button class="link" disabled=${!text.trim() && drafts.length === 0} onClick=${save}>${editing ? '완료' : '공유'}</button>`}
    </header>
    <div class="scroll">
      ${progress && html`<div class="small" style="color:var(--blue);padding:10px 16px 0">${progress}</div>`}
      <div class="picked">
        ${drafts.map(
          (d, i) => html`<div class="item" key=${d.key}>
            ${d.existing
              ? html`<img src=${d.existing.posterUrl || d.existing.url} alt="" />`
              : d.video
                ? html`<video src=${`${d.previewUrl}#t=0.1`} muted playsinline preload="metadata"></video>`
                : html`<img src=${d.previewUrl} alt="" />`}
            ${(d.video || d.existing?.kind === 'video') && html`<span class="play"><${Icon} name="play" filled size="sm" /></span>`}
            ${i === 0 && html`<span class="tag">대표</span>`}
            ${!busy && html`<button class="x" onClick=${() => setDrafts(drafts.filter((x) => x !== d))} aria-label="빼기"><${Icon} name="close" size="sm" /></button>`}
          </div>`,
        )}
        ${drafts.length < MAX_MEDIA &&
        !busy &&
        html`<button class="add" onClick=${() => input.current.click()}><${Icon} name="image" />사진·동영상</button>`}
      </div>
      <div class="small muted" style="padding:0 16px 12px">${drafts.length}/${MAX_MEDIA} · 사진은 자동으로 줄여서 올려요</div>
      <div style="border-top:0.5px solid var(--line);border-bottom:0.5px solid var(--line)">
        <textarea class="plain-text" placeholder="문구를 입력하세요..." value=${text} onInput=${(e) => setText(e.target.value)} disabled=${busy}></textarea>
      </div>
      ${error && html`<div class="error">${error}</div>`}
    </div>
    <input
      type="file"
      accept="image/*,video/*"
      multiple
      ref=${input}
      style="display:none"
      onChange=${(e) => {
        pick(e.target.files);
        e.target.value = '';
      }}
    />
  </div>`;
}
