/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // WFS brand — structural chrome stays fixed; accent is tenant-themable via CSS var
        navy:   { DEFAULT: '#080C16', 800: '#0E1424', 700: '#141C30', 600: '#1B2640', 500: '#27324F' },
        ice:    { DEFAULT: '#F1F5F9', dim: '#CBD5E1', faint: '#64748B' },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          soft:    'rgb(var(--accent) / 0.14)',
          line:    'rgb(var(--accent) / 0.32)',
        },
        ok:   '#34D399',
        warn: '#FBBF24',
        bad:  '#F87171',
        info: '#60A5FA',
      },
      fontFamily: {
        display: ['Syne', 'system-ui', 'sans-serif'],
        sans:    ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono:    ['"DM Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        deck: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 30px -12px rgba(0,0,0,0.6)',
        pop:  '0 18px 50px -12px rgba(0,0,0,0.7)',
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
