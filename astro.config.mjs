import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://dayuanjiang.github.io',
  base: '/TechRSS',

  vite: {
    plugins: [tailwindcss()],
  },
});