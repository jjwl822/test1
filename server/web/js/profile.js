import { useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { api, compressImage, enablePush, isIOS, pushEndpoint, pushState, store } from './api.js';
import { Avatar, Confirm, html, Icon, TopBar } from './ui.js';

/**
 * Turns on notifications, or explains "홈 화면에 추가" on iPhone Safari. On the chat list it only
 * appears when there's something to do; [always] (profile screen) also shows on/blocked states.
 */
export function PushBanner({ always = false }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pushState().then(setState);
  }, []);
  if (!state || (!always && state !== 'off' && state !== 'needs-install')) return null;

  if (state === 'needs-install') {
    return html`<div class="banner">
      <${Icon} name="share" />
      <div class="grow small">
        <div class="bold">홈 화면에 추가하면 알림을 받을 수 있어요</div>
        아래쪽 <b>공유 버튼</b> → <b>홈 화면에 추가</b>를 누른 뒤, 홈 화면의 가족 메신저 아이콘으로 열어 주세요.
      </div>
    </div>`;
  }
  if (state === 'blocked') {
    return html`<div class="banner">
      <${Icon} name="bell" />
      <div class="grow small">
        <div class="bold">알림이 꺼져 있어요</div>
        ${isIOS ? '설정 → 알림 → 가족 메신저에서 알림을 허용해 주세요.' : '브라우저 사이트 설정에서 알림을 허용해 주세요.'}
      </div>
    </div>`;
  }
  if (state === 'unsupported') {
    return html`<div class="banner"><${Icon} name="bell" /><div class="grow small">이 브라우저는 알림을 지원하지 않아요.</div></div>`;
  }
  if (state === 'on') {
    return html`<div class="banner"><${Icon} name="bell" /><div class="grow small"><div class="bold">알림이 켜져 있어요</div>앱을 닫아도 새 메시지를 알려드려요.</div></div>`;
  }
  return html`<div class="banner">
    <${Icon} name="bell" />
    <div class="grow small">
      <div class="bold">새 메시지 알림 받기</div>
      ${error ? html`<span style="color:var(--red)">${error}</span>` : '앱을 닫아도 가족 메시지를 바로 알려드려요.'}
    </div>
    <button
      class="btn"
      disabled=${busy}
      onClick=${async () => {
        setBusy(true);
        setError(null);
        try {
          await enablePush();
          setState('on');
        } catch (e) {
          setError(e.message);
          pushState().then(setState);
        } finally {
          setBusy(false);
        }
      }}
    >
      켜기
    </button>
  </div>`;
}

export function ProfileScreen({ me, onBack }) {
  const [name, setName] = useState(me.displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const file = useRef(null);

  async function act(work) {
    setBusy(true);
    setError(null);
    try {
      const user = await work();
      if (user) store.set({ me: user, users: new Map(store.users).set(user.id, user) });
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    const endpoint = await pushEndpoint().catch(() => undefined);
    await api.logout(endpoint).catch(() => {});
    location.hash = '/chats';
    location.reload();
  }

  return html`<div class="screen">
    <${TopBar} title="내 프로필" small onBack=${onBack} />
    <div class="scroll">
      <div style="display:flex;flex-direction:column;align-items:center;padding:24px 16px 8px;gap:8px">
        <${Avatar} name=${me.displayName} url=${me.avatarUrl} size=${96} ring />
        <div class="row">
          <button class="link" disabled=${busy} onClick=${() => file.current.click()}>사진 변경</button>
          ${me.avatarUrl && html`<button class="link danger" disabled=${busy} onClick=${() => act(() => api.deleteAvatar())}>사진 삭제</button>`}
        </div>
        <input
          type="file"
          accept="image/*"
          ref=${file}
          style="display:none"
          onChange=${(e) => {
            const f = e.target.files[0];
            e.target.value = '';
            if (f) act(async () => api.uploadAvatar(await compressImage(f, 640)));
          }}
        />
      </div>
      <div style="padding:0 16px">
        <label class="small muted">이름</label>
        <div class="row" style="margin-top:4px">
          <input class="field" value=${name} onInput=${(e) => { setName(e.target.value); setSaved(false); }} />
          <button
            class="btn"
            disabled=${busy || !name.trim() || name.trim() === me.displayName}
            onClick=${async () => setSaved(await act(() => api.updateName(name.trim())))}
          >
            저장
          </button>
        </div>
        ${saved && html`<div class="small" style="color:var(--blue);margin-top:4px">저장했어요</div>`}
        <div class="small muted" style="margin-top:6px">아이디: ${me.username}</div>
        ${error && html`<div class="error" style="padding:8px 0">${error}</div>`}
      </div>
      <div class="section-title">알림</div>
      <${PushBanner} always />
      <div style="padding:24px 16px">
        <button class="btn gray block" onClick=${() => setConfirmLogout(true)}>로그아웃</button>
      </div>
    </div>
    ${confirmLogout &&
    html`<${Confirm}
      title="로그아웃할까요?"
      text="이 기기에서는 새 메시지 알림을 받을 수 없어요."
      confirm="로그아웃"
      onClose=${() => setConfirmLogout(false)}
      onConfirm=${logout}
    />`}
  </div>`;
}
