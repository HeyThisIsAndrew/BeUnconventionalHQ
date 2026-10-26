const DOMAIN = 'HQ_AUTOMATION_V1';
const encoder = new TextEncoder();

async function keyFor(secret, usages) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

/** Domain-separated HMAC: the existing WebSub secret never leaves Workers. */
export async function signAutomationRequest(secret, body, now = Date.now()) {
  const timestamp = String(Math.floor(now / 1000));
  const key = await keyFor(secret, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(`${DOMAIN}\n${timestamp}\n${body}`));
  const hex = [...new Uint8Array(signed)].map(n => n.toString(16).padStart(2, '0')).join('');
  return { 'Content-Type': 'application/json', 'X-HQ-Timestamp': timestamp, 'X-HQ-Signature': `sha256=${hex}` };
}

export async function verifyAutomationRequest(request, body, secret, now = Date.now()) {
  const timestamp = request.headers.get('X-HQ-Timestamp') ?? '';
  const signature = request.headers.get('X-HQ-Signature') ?? '';
  if (!secret || !/^\d{10}$/.test(timestamp) || !/^sha256=[a-f0-9]{64}$/.test(signature) ||
      Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const bytes = Uint8Array.from(signature.slice(7).match(/../g), pair => parseInt(pair, 16));
  return crypto.subtle.verify('HMAC', await keyFor(secret, ['verify']), bytes, encoder.encode(`${DOMAIN}\n${timestamp}\n${body}`));
}
