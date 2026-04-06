import js from '@eslint/js'

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Extension globals
        chrome: 'readonly',
        browser: 'readonly',
        // Standard browser globals
        console: 'readonly',
        globalThis: 'readonly',
        crypto: 'readonly',
        window: 'readonly',
        document: 'readonly',
        location: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        performance: 'readonly',
        MutationObserver: 'readonly',
        SpeechSynthesisUtterance: 'readonly',
        SpeechSynthesis: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
]
