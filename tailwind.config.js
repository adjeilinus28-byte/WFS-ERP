/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // All structural colors read CSS variables (see index.css) so the app
        // can switch between the dark (default) and light themes at runtime.
        navy: {
          DEFAULT: 'rgb(var(--navy) / <alpha-value>)',
          900: 'rgb(var(--navy-900) / <alpha-value>)',
          800: 'rgb(var(--navy-800) / <alpha-value>)',
          700: 'rgb(var(--navy-700) / <alpha-value>)',
          600: 'rgb(var(--navy-600) / <alpha-value>)',
          500: 'rgb(var(--navy-500) / <alpha-value>)',
        },
        ice: {
          DEFAULT: 'rgb(var(--ice) / <alpha-value>)',
          dim:     'rgb(var(--ice-dim) / <alpha-value>)',
          faint:   'rgb(var(--ice-faint) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          soft:    'rgb(var(--accent) / 0.14)',
          line:    'rgb(var(--accent) / 0.32)',
        },
        ok:   'rgb(var(--ok) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        bad:  'rgb(var(--bad) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
      },
      // border-white/N is used app-wide as "hairline". Point it at --line so
      // hairlines are white-on-dark and slate-on-light without touching pages.
      borderColor: {
        white: 'rgb(var(--line) / <alpha-value>)',
      },
      // bg-white/[0.0x] hover washes flip the same way via --wash.
      backgroundColor: {
        white: 'rgb(var(--wash) / <alpha-value>)',
      },
      ringColor: {
        white: 'rgb(var(--line) / <alpha-value>)',
      },
      divideColor: {
        white: 'rgb(var(--line) / <alpha-value>)',
      },
      fontFamily: {
        display: ['Syne', 'system-ui', 'sans-serif'],
        sans:    ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono:    ['"DM Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        deck: 'var(--shadow-deck)',
        pop:  'var(--shadow-pop)',
      },
      keyframes: {
        'slide-in': { '0%': { transform: 'translateX(100%)' }, '100%': { transform: 'translateX(0)' } },
        'fade-in':  { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        'rise':     { '0%': { opacity: 0, transform: 'translateY(6px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
      },
      animation: {
        'slide-in': 'slide-in .28s cubic-bezier(.22,1,.36,1)',
        'fade-in':  'fade-in .2s ease-out',
        'rise':     'rise .35s cubic-bezier(.22,1,.36,1) both',
      },
    },
  },
  plugins: [],
}
