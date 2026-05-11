import 'dotenv/config';
import http from 'node:http';
import { Spectrum } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';
import { terminal } from 'spectrum-ts/providers/terminal';
import { handleMessage } from './handlers/message.js';

const PROVIDER = (process.env.SPECTRUM_PROVIDER ?? 'imessage').toLowerCase();

// Render (and similar) Web services require a process listening on PORT for health checks.
// Without this, the platform may mark the instance unhealthy or recycle it, which drops the
// Spectrum / iMessage connection so inbound messages never reach the handler.
const port = Number(process.env.PORT);
if (Number.isFinite(port) && port > 0) {
  http
    .createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ok');
    })
    .listen(port, '0.0.0.0', () => {
      console.log(`Health check listening on 0.0.0.0:${port}`);
    });
}

const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [
    PROVIDER === 'terminal' ? terminal.config() : imessage.config(),
  ],
});

console.log(`Remi is online. provider=${PROVIDER}`);

for await (const [space, message] of app.messages) {
  try {
    await space.responding(async () => {
      await handleMessage(space, message);
    });
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    console.error(`Error handling message in space ${space.id}:`, messageText);
  }
}
