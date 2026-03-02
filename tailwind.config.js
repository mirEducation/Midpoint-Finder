/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: '#022c22',
          base: '#065f46',
          accent: '#84cc16',
        },
      },
    },
  },
  plugins: [],
}
