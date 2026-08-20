/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import fs from 'fs';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}']
  },
  plugins: [
    react(),
    {
      name: 'bundle-chrome-extension',
      closeBundle() {
        const distDir = resolve(__dirname, 'dist');
        const panelDir = resolve(distDir, 'panel');
        const srcHtmlPath = resolve(distDir, 'src/panel/index.html');
        const destHtmlPath = resolve(panelDir, 'index.html');

        // 1. Move panel index.html to dist/panel/index.html and fix relative asset paths
        if (fs.existsSync(srcHtmlPath)) {
          if (!fs.existsSync(panelDir)) fs.mkdirSync(panelDir, { recursive: true });
          let htmlContent = fs.readFileSync(srcHtmlPath, 'utf8');
          htmlContent = htmlContent.replace(/\.\.\/\.\.\/panel\/assets\//g, './assets/');
          htmlContent = htmlContent.replace(/\.\.\/\.\.\/assets\//g, './assets/');
          htmlContent = htmlContent.replace(/\.\/assets\/panel\//g, './assets/');
          fs.writeFileSync(destHtmlPath, htmlContent, 'utf8');
          fs.rmSync(resolve(distDir, 'src'), { recursive: true, force: true });
        }

        // 2. Copy manifest.json into dist/
        const manifestSrc = resolve(__dirname, 'manifest.json');
        const manifestDest = resolve(distDir, 'manifest.json');
        if (fs.existsSync(manifestSrc)) {
          fs.copyFileSync(manifestSrc, manifestDest);
        }

        // 3. Copy only icons into dist/assets/icons/ (skipping readme screenshots)
        const iconsSrc = resolve(__dirname, 'assets/icons');
        const iconsDest = resolve(distDir, 'assets/icons');
        if (fs.existsSync(iconsSrc)) {
          if (!fs.existsSync(iconsDest)) fs.mkdirSync(iconsDest, { recursive: true });
          fs.cpSync(iconsSrc, iconsDest, { recursive: true });
        }
      }
    }
  ],
  server: {
    port: 5173,
    watch: {
      ignored: [
        '**/.vscode/**',
        '**/chrome-profile/**',
        '**/dist/**',
        '**/release/**',
        '**/tests/**',
        '**/docs/**',
        '**/.git/**',
        '**/node_modules/**',
        /[\\/]\.vscode[\\/]/,
        /[\\/]dist[\\/]/,
        /[\\/]release[\\/]/
      ]
    }
  },
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      input: {
        'panel/index': resolve(__dirname, 'src/panel/index.html'),
        background: resolve(__dirname, 'src/background.ts')
      },
      output: {
        entryFileNames: chunkInfo => {
          if (chunkInfo.name === 'background') {
            return 'background.js';
          }
          return 'panel/assets/index-[hash].js';
        },
        chunkFileNames: 'panel/assets/[name]-[hash].js',
        assetFileNames: 'panel/assets/[name]-[hash].[ext]'
      }
    }
  }
});
