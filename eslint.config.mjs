import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser
      }
    }
  },
  ...obsidianmd.configs.recommended
);
