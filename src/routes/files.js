import { json } from '../utils.js';

export async function handleServeFile(env, key) {
  if (!key) return json({ error: 'not_found' }, 404);
  const obj = await env.BUCKET.get(key);
  if (!obj) return json({ error: 'not_found' }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  if (!headers.has('content-disposition')) headers.set('content-disposition', 'inline');
  return new Response(obj.body, { headers });
}
