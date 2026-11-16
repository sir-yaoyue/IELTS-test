import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon.svg'],
      manifest: {
        name: '单词本 · 雅思',
        short_name: '单词本',
        description: '离线背单词：词库导入 + 间隔重复记忆（1-3-7-15）',
        lang: 'zh-CN',
        theme_color: '#f8fafc',
        background_color: '#f8fafc',
        display: 'standalone',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { port: 5199, host: true },
  preview: { port: 4199, host: true },
});
