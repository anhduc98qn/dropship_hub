import React, { useEffect, useState } from 'react';
import { screenshotUrl } from '../lib/supabase.js';

// Ảnh chụp trong bucket riêng tư (tự lấy link ký)
export default function Shot({ path, alt = 'Ảnh chụp', className = 'shot', onClick }) {
  const [url, setUrl] = useState(null);
  useEffect(() => { let on = true; screenshotUrl(path).then((u) => on && setUrl(u)); return () => { on = false; }; }, [path]);
  if (!path) return <div className={className + ' empty'}>Không có ảnh</div>;
  if (!url) return <div className={className + ' empty'}>Đang tải ảnh…</div>;
  return <img src={url} alt={alt} className={className} loading="lazy" onClick={onClick || (() => window.open(url, '_blank'))} />;
}
