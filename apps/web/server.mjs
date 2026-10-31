// Marcador de F0.2: se sustituye por Next.js en F0.7. Solo responde «OK».
import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 3000);
createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(`OK (modo ${process.env.APP_MODE ?? 'sandbox'})`);
}).listen(port, () => console.log(`web escuchando en ${port}`));
