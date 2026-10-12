"use client";

import { useState } from "react";

export default function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (res.ok) {
      window.location.reload();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "登录失败");
    }
  }

  return (
    <main className="login-screen">
      <div className="glow glow-a" aria-hidden />
      <div className="glow glow-b" aria-hidden />
      <form className="card login" onSubmit={submit}>
        <span className="brand-mark lg" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <h1>色卡工作台</h1>
        <p className="muted">输入访问密码以继续。</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码"
          autoFocus
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn primary block" disabled={loading || !password}>
          {loading ? "登录中…" : "登录"}
        </button>
      </form>
    </main>
  );
}
