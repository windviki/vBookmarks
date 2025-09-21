import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.chrome,
        chrome: 'readonly',
        console: 'readonly',
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly'
      }
    },
    rules: {
      // Modern JavaScript best practices
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-template': 'error',
      'template-curly-spacing': 'error',
      'prefer-destructuring': ['error', {
        'object': true,
        'array': false
      }],
      'prefer-object-spread': 'error',

      // Code quality
      'no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
      'no-console': 'warn',
      'no-debugger': 'error',
      'no-alert': 'warn',

      // Security
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',

      // ES6+ features
      'require-await': 'error',
      'no-await-in-loop': 'warn',

      // Style
      'indent': ['error', 2],
      'quotes': ['error', 'single'],
      'semi': ['error', 'always'],
      'comma-dangle': ['error', 'never'],
      'max-len': ['warn', { 'code': 100, 'ignoreUrls': true }],
      'max-lines-per-function': ['warn', { 'max': 50 }],
      'complexity': ['warn', 10]
    }
  }
];