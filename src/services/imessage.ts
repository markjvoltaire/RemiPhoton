import { cloud } from 'spectrum-ts';
import type { TokenData } from 'spectrum-ts';
import { createClient, chatGuid } from '@photon-ai/advanced-imessage';
import type { AdvancedIMessage } from '@photon-ai/advanced-imessage';

const IMESSAGE_ADDRESS =
  process.env.SPECTRUM_IMESSAGE_ADDRESS ?? 'imessage.spectrum.photon.codes:443';

let _client: AdvancedIMessage | null = null;
let _tokenData: TokenData | null = null;
let _tokenExpiresAt = 0;
const EXPIRY_BUFFER_MS = 60_000;

async function getToken(): Promise<string> {
  if (_tokenData && Date.now() < _tokenExpiresAt - EXPIRY_BUFFER_MS) {
    const t = _tokenData;
    return t.type === 'shared' ? t.token : (Object.values(t.auth)[0] as string);
  }
  _tokenData = await cloud.issueImessageTokens(
    process.env.PROJECT_ID!,
    process.env.PROJECT_SECRET!,
  );
  _tokenExpiresAt = Date.now() + _tokenData.expiresIn * 1000;
  const t = _tokenData;
  return t.type === 'shared' ? t.token : (Object.values(t.auth)[0] as string);
}

function getClient(): AdvancedIMessage {
  if (!_client) {
    _client = createClient({
      address: IMESSAGE_ADDRESS,
      tls: true,
      // token is an undocumented option used internally by spectrum-ts
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ token: getToken } as any),
    });
  }
  return _client;
}

export async function markRead(spaceId: string): Promise<void> {
  await getClient().chats.markRead(chatGuid(spaceId));
}
