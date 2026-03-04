/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"DM Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
      colors: {
        brand: {
          forest: '#1B3A2A',
          sage: '#7B9E82',
          amber: '#D4860A',
          'amber-light': '#E8960A',
          cream: '#F5EFE0',
          'cream-dark': '#E8EDDF',
          border: '#A8C4A0',
          'border-light': '#C8D5C0',
          muted: '#4A6B4A',
        },
      },
    },
  },
  plugins: [],
}
