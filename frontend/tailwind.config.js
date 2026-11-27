/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        moon: {
          50:  '#f5f5f0',
          100: '#e8e8df',
          200: '#d1d1be',
          300: '#b0b093',
          400: '#8e8e6a',
          500: '#737350',
          600: '#5a5a3f',
          700: '#424232',
          800: '#2d2d24',
          900: '#1a1a16',
          950: '#0d0d0a',
        },
        risk: {
          safe:      '#22c55e',
          caution:   '#f59e0b',
          unsafe:    '#ef4444',
          uncertain: '#6366f1',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
