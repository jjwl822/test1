import { useState } from '../vendor/preact-htm.js';
import { api, store } from './api.js';
import { html } from './ui.js';

export function LoginScreen() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ familyCode: '', displayName: '', username: localStorage.getItem('lastUsername') || '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const register = mode === 'register';
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const ready = form.username.trim() && form.password && (!register || (form.familyCode.trim() && form.displayName.trim()));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const username = form.username.trim();
      const res = register
        ? await api.register({ ...form, username, familyCode: form.familyCode.trim(), displayName: form.displayName.trim() })
        : await api.login(username, form.password);
      try {
        localStorage.setItem('lastUsername', username);
      } catch {
        // private mode
      }
      store.set({ me: res.user });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return html`<div class="scroll">
    <form class="login" onSubmit=${submit}>
      <img class="logo" src="/icons/icon-192.png" alt="" />
      <h1>가족 메신저</h1>
      <p class="muted">우리 가족끼리만 쓰는 대화방</p>
      <div class="segment">
        <button type="button" class=${!register ? 'on' : ''} onClick=${() => setMode('login')}>로그인</button>
        <button type="button" class=${register ? 'on' : ''} onClick=${() => setMode('register')}>가입하기</button>
      </div>
      ${register &&
      html`<input class="field" placeholder="가족 코드" value=${form.familyCode} onInput=${set('familyCode')} autocomplete="off" />
        <input class="field" placeholder="이름 (예: 엄마, 아빠, 민수)" value=${form.displayName} onInput=${set('displayName')} />`}
      <input
        class="field"
        placeholder="아이디"
        value=${form.username}
        onInput=${set('username')}
        autocapitalize="none"
        autocorrect="off"
        autocomplete="username"
      />
      <input
        class="field"
        type="password"
        placeholder="비밀번호"
        value=${form.password}
        onInput=${set('password')}
        autocomplete=${register ? 'new-password' : 'current-password'}
      />
      ${error && html`<div class="error" style="padding:0">${error}</div>`}
      <button class="btn block" type="submit" disabled=${!ready || busy}>${busy ? '잠시만요…' : register ? '가입하고 시작하기' : '로그인'}</button>
      ${register && html`<p class="small muted">가족 코드는 서버를 켠 가족에게 물어보세요.</p>`}
    </form>
  </div>`;
}
