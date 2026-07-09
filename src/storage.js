const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || "";
const TABLE = "acrf_cases";

const h = () => ({
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
  "Prefer": "return=representation",
});

export async function dbReadAll() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return localRead();
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=created_at.desc`, { headers: h() });
    if (!res.ok) return localRead();
    const rows = await res.json();
    return Array.isArray(rows) ? rows.map(r => r.data) : [];
  } catch { return localRead(); }
}

export async function dbWriteEntry(entry) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return localWrite(entry);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: { ...h(), "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ id: entry.id, data: entry, created_at: entry.savedAt })
    });
    return res.ok;
  } catch { return false; }
}

export async function dbDeleteEntry(id) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    localStorage.setItem("acrf_cases", JSON.stringify(localRead().filter(e => e.id !== id)));
    return true;
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${id}`, { method: "DELETE", headers: h() });
    return res.ok;
  } catch { return false; }
}

export async function dbUpdateEntry(entry) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return localWrite(entry);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${entry.id}`, {
      method: "PATCH", headers: h(), body: JSON.stringify({ data: entry })
    });
    return res.ok;
  } catch { return false; }
}

function localRead() {
  try { const r = localStorage.getItem("acrf_cases"); return r ? JSON.parse(r) : []; } catch { return []; }
}
function localWrite(entry) {
  try {
    const all = [entry, ...localRead().filter(e => e.id !== entry.id)];
    localStorage.setItem("acrf_cases", JSON.stringify(all));
    return true;
  } catch { return false; }
}
