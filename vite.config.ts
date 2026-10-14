import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from https://<user>.github.io/<repository>/ so the build needs a
// matching base path. The deploy workflow sets VITE_BASE automatically (e.g. "/my-repo/").
// For local development the default "/" is used.
export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          office: ['exceljs', 'jspdf', 'jspdf-autotable'],
        },
      },
    },
  },
  server: { port: 5173, host: true },
  define: { __DEV__: JSON.stringify(mode !== 'production') },
}));
