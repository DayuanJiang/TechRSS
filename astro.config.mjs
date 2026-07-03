import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://techrss.jiang.jp',

  vite: {
    plugins: [tailwindcss()],
  },
});