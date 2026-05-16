const Auth = (() => {
  const KEY = 'st_auth_v1';

  function get() {
    try { return JSON.parse(localStorage.getItem(KEY)); }
    catch { return null; }
  }

  function set(role, passcode) {
    localStorage.setItem(KEY, JSON.stringify({ role, passcode }));
  }

  function clear() {
    localStorage.removeItem(KEY);
  }

  function isEditor() {
    return get()?.role === 'editor';
  }

  function isLoggedIn() {
    return !!get()?.role;
  }

  async function verify(passcode) {
    const res = await fetch(STOCK_AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode }),
    });
    if (!res.ok) return null;
    const { role } = await res.json();
    return role || null;
  }

  return { get, set, clear, isEditor, isLoggedIn, verify };
})();
