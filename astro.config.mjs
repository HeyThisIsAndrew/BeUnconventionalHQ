// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://heythisisandrew.github.io',
  base: '/BeUnconventionalHQ',
  vite: {
    plugins: [tailwindcss()]
  }
});