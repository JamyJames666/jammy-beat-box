/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        app: {
          bg:            '#0d0d0d',
          surface:       '#141414',
          panel:         '#1c1c1c',
          border:        '#272727',
          accent:        '#a855f7',
          'accent-dark': '#9333ea',
          text:          '#ffffff',
          muted:         '#888888',
          danger:        '#f43f5e',
          spotify:       '#1db954',
          youtube:       '#ff0000',
        },
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
        glow: '0 0 20px rgba(168,85,247,0.25)',
      },
    },
  },
  plugins: [],
}
