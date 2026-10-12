import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const compress = promisify(gzip);

/** An explicit exclusion takes precedence over a wildcard; absent negotiation keeps old clients unchanged. */
function acceptsGzip(value) {
  const encodings = String(value || '').split(',').map(item => {
    const [name, ...parameters] = item.trim().toLowerCase().split(';');
    const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
    const weight = quality === undefined ? 1 : Number(quality.trim().slice(2));
    return { name, allowed: Number.isFinite(weight) && weight > 0 && weight <= 1 };
  });
  return (encodings.find(item => item.name === 'gzip') || encodings.find(item => item.name === '*'))?.allowed === true;
}

/** Compress only buffered public text or state/chat reads; streaming events, credentials and attachments never enter here. */
export async function sendBufferedResponse(req, res, bytes, headers) {
  const text = /^(?:text\/|application\/(?:json|manifest\+json))/.test(headers['Content-Type'] || '');
  const eligible = text && bytes.length >= 1024;
  const encoded = eligible && acceptsGzip(req.headers['accept-encoding']);
  const body = encoded ? await compress(bytes) : bytes;
  // A cancelled browser read must not turn a later async compression result into another response.
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(200, {
    ...headers,
    ...(eligible ? { Vary: 'Accept-Encoding' } : {}),
    ...(encoded ? { 'Content-Encoding': 'gzip' } : {}),
    'Content-Length': body.length,
  });
  res.end(body);
}
