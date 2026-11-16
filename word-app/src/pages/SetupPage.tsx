import { useState } from 'react';
import { seedBuiltInBooks } from '../lib/seed';

export default function SetupPage() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const run = async () => {
    setBusy(true);
    try {
      const r = await seedBuiltInBooks();
      setMsg(r.map((x) => `${x.bookName} ${x.total} 条`).join(' · '));
      // App 的 useLiveQuery 会自动切换到主界面
    } catch (e) {
      setMsg(`导入失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 max-w-md w-full text-center space-y-5">
        <div className="text-5xl">📖</div>
        <div>
          <h1 className="text-2xl font-bold">单词本 · 首次设置</h1>
          <p className="text-sm text-slate-500 mt-2">
            数据只保存在本机浏览器（IndexedDB），无需账号，完全离线可用。
          </p>
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="w-full py-3.5 rounded-2xl bg-slate-900 text-white font-medium disabled:opacity-50 hover:bg-slate-800"
        >
          {busy ? '导入中…' : '导入内置词库（核心200词 + 册2）'}
        </button>
        {msg && <p className="text-xs text-slate-400">{msg}</p>}
      </div>
    </div>
  );
}
