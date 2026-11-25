/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Rojo institucional de la Alcaldía de Ibarra (logo).
        primary: {
          DEFAULT: '#b3121f',
          soft: '#fbeaec',
          deep: '#7f0c16'
        },
        secondary: '#d4343f',
        // Acento: el mismo rojo, más vivo, para botones de acción.
        accent: {
          DEFAULT: '#e4132a',
          hover: '#b3121f',
          soft: '#fdecee'
        },
        // Gris oscuro del logo: sidebar y superficies oscuras.
        surface: {
          dark: '#1f2429',
          darksoft: '#2b3238'
        }
      },
      fontFamily: {
        sans: ['Montserrat', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};
