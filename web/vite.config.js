import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './': web/dist mở được ở mọi đường dẫn (Netlify, máy chủ test localhost:8787)
export default defineConfig({ plugins: [react()], base: './' });
