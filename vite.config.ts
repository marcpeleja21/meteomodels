import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  build: {
    target: 'es2020',
  },

  plugins: [
    VitePWA({
      registerType: 'autoUpdate',

      // Assets to include verbatim in the SW precache
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'icons/**/*.png',
      ],

      // ── Web App Manifest ────────────────────────────────────────────────────
      manifest: {
        name:             'MeteoModels – Comparativa de Models',
        short_name:       'MeteoModels',
        description:      'Compara els models meteorològics més precisos del món: GFS, ECMWF, ICON, AROME, ARPEGE i més en temps real.',
        theme_color:      '#0b1220',
        background_color: '#0b1220',
        display:          'standalone',
        orientation:      'portrait-primary',
        start_url:        '/',
        scope:            '/',
        id:               '/',
        lang:             'ca',
        categories:       ['weather', 'utilities'],
        dir:              'ltr',

        icons: [
          { src: 'icons/icon-72x72.png',         sizes: '72x72',   type: 'image/png' },
          { src: 'icons/icon-96x96.png',         sizes: '96x96',   type: 'image/png' },
          { src: 'icons/icon-128x128.png',       sizes: '128x128', type: 'image/png' },
          { src: 'icons/icon-144x144.png',       sizes: '144x144', type: 'image/png' },
          { src: 'icons/icon-152x152.png',       sizes: '152x152', type: 'image/png' },
          { src: 'icons/icon-192x192.png',       sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-384x384.png',       sizes: '384x384', type: 'image/png' },
          { src: 'icons/icon-512x512.png',       sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-192x192.png',   sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/maskable-512x512.png',   sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],

        screenshots: [
          {
            src:         'screenshots/desktop.png',
            sizes:       '1280x800',
            type:        'image/png',
            form_factor: 'wide',
            label:       'MeteoModels – Comparativa de models meteorològics',
          },
          {
            src:         'screenshots/mobile.png',
            sizes:       '390x844',
            type:        'image/png',
            form_factor: 'narrow',
            label:       'MeteoModels – previsió mòbil',
          },
        ],
      },

      // ── Workbox (service worker) ────────────────────────────────────────────
      workbox: {
        // Precache everything built by Vite
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],

        runtimeCaching: [
          // Open-Meteo weather API — network-first, 1 h cache fallback
          {
            urlPattern: /^https:\/\/api\.open-meteo\.com\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'openmeteo-api',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 40, maxAgeSeconds: 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Open-Meteo AQI endpoint
          {
            urlPattern: /^https:\/\/air-quality-api\.open-meteo\.com\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'openmeteo-aqi',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 10, maxAgeSeconds: 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Geocoding — stale-while-revalidate, 24 h
          {
            urlPattern: /^https:\/\/geocoding-api\.open-meteo\.com\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'geocoding',
              expiration: { maxEntries: 100, maxAgeSeconds: 86400 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Leaflet tiles & assets — cache-first, 30 days
          {
            urlPattern: /^https:\/\/(unpkg\.com\/leaflet|tile\.openstreetmap\.org)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-assets',
              expiration: { maxEntries: 200, maxAgeSeconds: 2592000 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Windy webcam API
          {
            urlPattern: /^https:\/\/api\.windy\.com\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'windy-api',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 20, maxAgeSeconds: 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // MeteoBlue
          {
            urlPattern: /^https:\/\/my\.meteoblue\.com\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'meteoblue-api',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 10, maxAgeSeconds: 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
