'use strict';

const { validateURL, invalid } = require('./safety');

// GET com a mesma política do SafeHTTP do Swift: só HTTPS na lista permitida,
// inclusive em cada redirecionamento; sem cookies/cache; limite de bytes e tempo.
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 90000;

async function safeGet(address, limit, { fetchImpl = globalThis.fetch, userAgent = 'iWallPeek' } = {}) {
  let url = validateURL(address);
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response;
    try {
      response = await fetchImpl(url.href, {
        redirect: 'manual',
        signal,
        cache: 'no-store',
        credentials: 'omit',
        headers: { 'User-Agent': userAgent, Accept: '*/*' }
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw invalid('O serviço demorou demais para responder.');
      }
      throw invalid('Não foi possível conectar ao serviço. Verifique a internet.');
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel?.();
      if (!location) throw invalid('O serviço não retornou uma resposta válida.');
      // Redirecionamento para fora da lista é recusado antes de qualquer conexão.
      url = validateURL(new URL(location, url));
      continue;
    }

    if (response.status !== 200) {
      await response.body?.cancel?.();
      throw invalid('O serviço não retornou uma resposta válida.');
    }

    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > limit) {
      await response.body?.cancel?.();
      throw invalid('Download excede o limite permitido.');
    }

    const chunks = [];
    let total = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw invalid('Download excede o limite permitido.');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  }

  throw invalid('Redirecionamentos demais.');
}

module.exports = { safeGet };
