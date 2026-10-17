import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, q } from './supabase.js';

// Danh sách mẫu + người dùng; tự tải lại khi có thay đổi (realtime) và mỗi 2 phút (dự phòng khi realtime rớt)
export function useProducts() {
  const [products, setProducts] = useState(null);
  const [people, setPeople] = useState({});
  const [error, setError] = useState(null);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const [rows, profiles] = await Promise.all([
        q(supabase.from('products').select('*').order('created_at', { ascending: false }).limit(2000)),
        q(supabase.from('profiles').select('id, full_name, staff_code, role, active, telegram_username')),
      ]);
      setProducts(rows);
      setPeople(Object.fromEntries(profiles.map((p) => [p.id, p])));
      setError(null);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => {
    load();
    const soon = () => { clearTimeout(timer.current); timer.current = setTimeout(load, 800); };
    const ch = supabase.channel('products-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, soon)
      .subscribe();
    const poll = setInterval(load, 120e3);
    const onFocus = () => document.visibilityState === 'visible' && soon();
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(poll);
      clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [load]);

  // Cập nhật 1 dòng ngay trên giao diện (sau khi sửa) mà không chờ tải lại
  const patchLocal = useCallback((row) => setProducts((xs) => xs && xs.map((x) => (x.id === row.id ? row : x))), []);
  const removeLocal = useCallback((id) => setProducts((xs) => xs && xs.filter((x) => x.id !== id)), []);
  return { products, people, error, reload: load, patchLocal, removeLocal };
}

export async function updateProduct(id, patch) {
  const rows = await q(supabase.from('products').update(patch).eq('id', id).select());
  if (!rows?.length) throw new Error('Không sửa được mẫu này (không có quyền hoặc mẫu đã bị xóa)');
  return rows[0];
}
