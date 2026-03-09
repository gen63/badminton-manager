import { defineConfig } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  preset: {
    transparent: {
      sizes: [192, 512],
      favicons: [[64, 'favicon.ico']],
    },
    maskable: {
      sizes: [512],
      padding: 0.1,
    },
    apple: {
      sizes: [180],
      padding: 0,
    },
  },
  images: ['public/favicon.svg'],
})
