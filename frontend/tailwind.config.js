/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Design tokens — mirror the CSS custom props in index.css
        app: {
          bg:            '#0b0608',
          surface:       '#160b0e',
          panel:         '#200e14',
          border:        '#3d1726',
          accent:        '#f43f5e',
          'accent-dark': '#e11d48',
          'accent-2':    '#f97316',
          text:          '#fff5f7',
          muted:         '#c07080',
          danger:        '#ef4444',
          spotify:       '#1db954',
          youtube:       '#ff0000',
        },
        // DJ Deck v3 tokens
        'deck-a':      '#3b82f6',
        'deck-b':      '#f97316',
        lcd:           '#86efac',
        'lcd-bg':      '#060e06',
        'meter-green': '#22c55e',
        'meter-yellow':'#eab308',
        'meter-red':   '#ef4444',
      },
      borderRadius: {
        '4': '4px',
      },
      keyframes: {
        bar: {
          '0%, 100%': { height: '3px' },
          '50%':       { height: '14px' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
      },
      animation: {
        bar:           'bar 0.9s ease-in-out infinite',
        'bar-2':       'bar 0.9s ease-in-out 0.2s infinite',
        'bar-3':       'bar 0.9s ease-in-out 0.4s infinite',
        'fade-up':     'fade-up 0.25s ease-out',
        'slide-down':  'slide-down 0.2s ease-out',
        shimmer:       'shimmer 1.5s linear infinite',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.6)',
        glow: '0 0 20px rgba(244,63,94,0.25)',
      },
    },
  },
  plugins: [],
}
