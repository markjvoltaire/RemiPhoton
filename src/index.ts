import 'dotenv/config';
import { Spectrum } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';
import { terminal } from 'spectrum-ts/providers/terminal';
import { handleMessage } from './handlers/message.js';

const PROVIDER = (process.env.SPECTRUM_PROVIDER ?? 'imessage').toLowerCase();

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
