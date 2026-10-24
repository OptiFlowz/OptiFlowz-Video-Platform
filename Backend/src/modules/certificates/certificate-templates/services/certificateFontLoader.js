import { request } from 'node:https';
import { lookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import postcss from 'postcss';
import { validateTemplateContent } from '../helpers/templateContent.validation.js';
import { FONT_ORIGIN, RESOURCE_LIMITS, resourceError, httpsResourceUrl, googleFontStylesheet,
  fontContentType, rewriteFontSources } from '../helpers/certificateResources.js';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) blocked.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) {
  blocked.addSubnet(address, prefix, 'ipv6');
}

export function isPublicFontAddress(address) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

// Validate the addresses used by the socket itself: a second DNS lookup cannot rebind to a private host.
export function publicFontLookup(hostname, options, callback) {
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(({ address }) => !isPublicFontAddress(address))) {
      return callback(resourceError('Font hosts must resolve only to public Internet addresses'));
    }
    const candidates = options.family ? addresses.filter(item => item.family === options.family) : addresses;
    if (!candidates.length) return callback(resourceError('No supported public font address'));
    if (options.all) return callback(null, candidates);
    return callback(null, candidates[0].address, candidates[0].family);
  });
}

export async function fetchFontResource(value, { signal, maxBytes = RESOURCE_LIMITS.fontBytes, stylesheet = false } = {}) {
  const url = stylesheet ? new URL(googleFontStylesheet(value)) : httpsResourceUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (url.port || url.hash || hostname.toLowerCase() === 'localhost'
    || (isIP(hostname) && !isPublicFontAddress(hostname))) {
    throw resourceError('Font URLs must use public HTTPS hosts on port 443');
  }
  const abortSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(RESOURCE_LIMITS.timeoutMs)]);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      agent: false, lookup: publicFontLookup, signal: abortSignal,
      headers: { accept: stylesheet ? 'text/css' : 'font/woff2,font/woff,font/ttf,font/otf',
        'user-agent': 'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36', 'accept-encoding': 'identity' },
    }, response => {
      const stop = message => { response.destroy(); reject(resourceError(message)); };
      // Redirect targets are never followed (including redirects to loopback or metadata services).
      if (response.statusCode !== 200) return stop('Font resource returned an error or redirect');
      if (stylesheet && !/^text\/css(?:;|$)/i.test(response.headers['content-type'] || '')) return stop('Invalid font stylesheet content type');
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') return stop('Compressed font responses are not supported');
      if (Number(response.headers['content-length']) > maxBytes) return stop('Font resource exceeds the size limit');
      const chunks = [];
      let length = 0;
      response.on('error', reject);
      response.on('data', chunk => {
        length += chunk.length;
        if (length > maxBytes) { stop('Font resource exceeds the size limit'); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', () => reject(resourceError('Unable to load font resource from a public HTTPS host')));
    req.end();
  });
}

export function createCertificateFontLoader(document, signal) {
  const sources = [...(document.fontSources || [])];
  const stylesheets = [...new Set(document.fontStylesheets || [])];
  if (sources.length > RESOURCE_LIMITS.fonts || stylesheets.length > RESOURCE_LIMITS.stylesheets) throw resourceError('Too many font resources');
  const cache = new Map();
  let totalBytes = 0;
  let failure;
  function account(bytes) {
    totalBytes += bytes.length;
    if (totalBytes > RESOURCE_LIMITS.totalBytes) throw resourceError('Font resources exceed the total size limit');
  }
  return {
    async stylesheet() {
      const rules = [];
      for (const url of stylesheets) {
        const bytes = await fetchFontResource(url, { signal, stylesheet: true, maxBytes: RESOURCE_LIMITS.stylesheetBytes });
        account(bytes);
        const css = bytes.toString('utf8');
        validateTemplateContent({ css_template: css });
        const root = postcss.parse(css);
        if (root.nodes.some(node => node.type !== 'comment'
          && !(node.type === 'atrule' && node.name.toLowerCase() === 'font-face'
            && node.nodes.every(child => ['decl', 'comment'].includes(child.type))))) {
          throw resourceError('Font stylesheets may contain only @font-face declarations');
        }
        rewriteFontSources(root, sources);
        rules.push(root.toString());
      }
      return rules.join('\n');
    },
    async route(route) {
      const req = route.request();
      const match = new RegExp(`^${FONT_ORIGIN.replaceAll('.', '\\.')}\\/(\\d+)$`).exec(req.url());
      if (req.resourceType() !== 'font' || !match || !sources[Number(match[1])]) return route.abort('blockedbyclient');
      const index = Number(match[1]);
      try {
        if (!cache.has(index)) cache.set(index, (async () => {
          const bytes = await fetchFontResource(sources[index], { signal, maxBytes: RESOURCE_LIMITS.fontBytes });
          account(bytes);
          const contentType = fontContentType(bytes);
          if (!contentType) throw resourceError('Resource is not a supported WOFF, WOFF2, TTF or OTF font');
          return { body: bytes, contentType };
        })());
        const response = await cache.get(index);
        await route.fulfill({ ...response, status: 200, headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' } });
      } catch (error) {
        failure = error;
        await route.abort('blockedbyclient').catch(() => {});
      }
    },
    check() { if (failure) throw failure; },
  };
}
