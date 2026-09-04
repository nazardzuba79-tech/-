export default {content: [
  './index.html',
  './src/**/*.{js,ts,jsx,tsx}'
],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0B0C0E',
          soft: '#131518',
          panel: '#101215',
          line: '#23262B',
          mute: '#8A9099',
        },
        canvas: '#F3F4F5',
        line: '#E3E4E7',
        muted: '#6E727A',
        faint: '#9A9EA6',
        accent: {
          DEFAULT: '#C08A18',
          bright: '#D9A43B',
          soft: '#FBF4E4',
          line: '#E8D6A9',
        },
        pos: '#0F9D58',
        neg: '#C8402E',
      },
      fontFamily: {
        sans: ['Inter','-apple-system','BlinkMacSystemFont','Segoe UI','Helvetica Neue','Arial','sans-serif'],
      },
    },
  },
}
