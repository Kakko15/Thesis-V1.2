// Strict ESLint configuration — ISO/IEC 25010 Maintainability evidence
// (thesis paper, Section 3.2.4: ESLint enforces ECMAScript standards and
// evaluates structural maintainability of the React frontend).
import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'node_modules']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: { react },
    rules: {
      // Mark identifiers referenced from JSX as used
      'react/jsx-uses-vars': 'error',
      // Correctness
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
      'no-return-assign': 'error',
      // Complexity / maintainability
      complexity: ['warn', 24],
      'max-depth': ['warn', 5],
      'no-nested-ternary': 'off',
      // Hygiene
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-alert': 'error',
      'no-debugger': 'error',
    },
  },
  {
    // Context providers export hooks and Motion exports shared animation
    // variants alongside components — intentional, not a fast-refresh concern.
    files: ['**/context/**/*.jsx', '**/components/ui/Motion.jsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
