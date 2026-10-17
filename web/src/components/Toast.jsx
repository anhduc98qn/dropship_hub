import React, { createContext, useCallback, useContext, useState } from 'react';

const Ctx = createContext(() => {});
export const useToast = () => useContext(Ctx);

// toast(text, { error, action: { label, run }, ms })
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const toast = useCallback((text, opt = {}) => {
    const id = Math.random();
    setItems((xs) => [...xs, { id, text, ...opt }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), opt.ms || (opt.error ? 7000 : 4000));
  }, []);
  const drop = (id) => setItems((xs) => xs.filter((x) => x.id !== id));
  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className="toasts" role="status">
        {items.map((t) => (
          <div key={t.id} className={'toast' + (t.error ? ' err' : '')}>
            <span>{t.text}</span>
            {t.action && <button className="btn sm" onClick={() => { drop(t.id); t.action.run(); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
