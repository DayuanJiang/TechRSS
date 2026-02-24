import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://your-username.github.io',
  base: '/TechRSS',

  vite: {
    plugins: [tailwindcss()],
  },
});