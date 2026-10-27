import { isIP } from 'node:net';

export function configureProxy(app) {
  const onFly = Boolean(process.env.FLY_APP_NAME);
  app.set('trust proxy', onFly ? 1 : false);
  if (!onFly) return;

  // Fly Proxy supplies Fly-Client-IP. Its raw X-Forwarded-For chain can
  // contain client-supplied entries and ends with the app's public IP.
  // Only trust the single normalized hop, never that incoming chain.
  // server.js binds IPv4 so private IPv6 traffic cannot bypass Fly Proxy.
  app.use((req, res, next) => {
    const clientIp = req.get('fly-client-ip');
    if (clientIp !== undefined && !isIP(clientIp)) {
      return res.status(400).json({ success: false, message: 'Invalid Fly-Client-IP header' });
    }
    if (clientIp) req.headers['x-forwarded-for'] = clientIp;
    // Direct health probes may lack Fly headers; use their socket address.
    else delete req.headers['x-forwarded-for'];
    next();
  });
}
