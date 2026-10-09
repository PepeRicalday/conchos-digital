import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dev-dist', 'supabase/functions']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn'
    },
  },
  // Núcleo de SICA Conservación: TypeScript puro y determinista. Sin React, Supabase, Node, navegador,
  // reloj ni azar. El motor recibe la fecha de referencia y los datos por parámetro.
  {
    files: ['src/conservacion/nucleo/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['react', 'react-*', 'react/*'], message: 'El núcleo no depende de React.' },
          { group: ['@supabase/*'], message: 'El núcleo no accede a Supabase: recibe los datos por parámetro.' },
          { group: ['node:*', 'fs', 'path'], message: 'El núcleo no lee archivos: los datos llegan ya cargados.' },
          { group: ['hyperformula'], message: 'HyperFormula es GPL: solo como herramienta interna, nunca en el núcleo.' },
          { group: ['../../lib/*', '../../../lib/*', '../../../components/*', '../../../pages/*'], message: 'El núcleo no importa código de la aplicación.' },
        ],
      }],
      'no-restricted-globals': ['error',
        ...['window', 'document', 'localStorage', 'sessionStorage', 'fetch', 'process', 'navigator'].map((name) => ({
          name, message: 'El núcleo es puro: sin navegador, red ni entorno.',
        })),
      ],
      'no-restricted-properties': ['error',
        { object: 'Date', property: 'now', message: 'Sin reloj: la fecha de referencia llega en el contexto.' },
        { object: 'Math', property: 'random', message: 'Sin azar: el motor es determinista.' },
      ],
      'no-restricted-syntax': ['error', {
        selector: "NewExpression[callee.name='Date'][arguments.length=0]",
        message: 'Sin reloj: la fecha de referencia llega en el contexto.',
      }],
    },
  },
])
