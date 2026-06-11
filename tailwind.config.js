/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        clinic: {
          50:  '#f0faf7',
          100: '#d0f0e6',
          200: '#a0e0cc',
          300: '#5fc9ab',
          400: '#2eaf90',
          500: '#1a9478',
          600: '#127860',
          700: '#0e5f4c',
          800: '#0a4437',
          900: '#062c24',
        },
      },
    },
  },
  plugins: [],
};
