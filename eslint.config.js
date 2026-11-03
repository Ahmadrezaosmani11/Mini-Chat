import n from 'eslint-plugin-n';
import security from 'eslint-plugin-security';

export default [
  n.configs['flat/recommended-module'],
  security.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: {
      'n/no-missing-import': 'off',
      'n/no-unpublished-import': 'off',
      'security/detect-object-injection': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  { files: ['src/ui/**/*.js'], languageOptions: { globals: { window: 'readonly', document: 'readonly', fetch: 'readonly', EventSource: 'readonly', FormData: 'readonly', URL: 'readonly', Image: 'readonly', FileReader: 'readonly' } } },
  { ignores: ['dist/**', 'node_modules/**'] },
];
