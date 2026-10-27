import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // El enlace de recuperacion lleva un secreto en el fragmento. El fragmento no
        // viaja al servidor, pero el navegador podria filtrarlo via `Referer` hacia
        // recursos o enlaces externos, y una copia en cache lo dejaria expuesto:
        // `no-referrer` y `no-store` se aplican SOLO a esta ruta, sin tocar el resto.
        source: '/reset-password',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store, max-age=0' }
        ]
      }
    ];
  }
};

export default nextConfig;
