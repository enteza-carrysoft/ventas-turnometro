import { load } from 'cheerio';

export interface Visible {
  title: string;
  /** texto visible, una línea por bloque, sin espacios repetidos */
  text: string;
  /** enlaces http(s) absolutos y visibles, sin ancla ni duplicados */
  links: string[];
  anchors: Array<{ url: string; text: string }>;
}

const BLOCKS = 'p,div,li,h1,h2,h3,h4,h5,h6,tr,section,article,header,footer,nav,ul,ol,table,form,dt,dd,blockquote';

/**
 * Texto que ve una persona en la página. Lo que no se ve (scripts, estilos, `hidden`, `aria-hidden`, `display:none`,
 * `visibility:hidden`, comentarios, `<noscript>`) no llega al modelo: es la vía más común de inyectar instrucciones ocultas (P5.4).
 */
export function extractVisible(htmlText: string, baseUrl: string): Visible {
  const $ = load(htmlText);
  const title = $('title').first().text().replace(/\s+/g, ' ').trim();
  $('script,style,noscript,template,svg,iframe,object,embed,meta,link,title').remove();
  $('[hidden],[aria-hidden="true"],input[type="hidden"]').remove();
  $('[style]').each((_, el) => {
    const style = ($(el).attr('style') ?? '').toLowerCase().replace(/\s+/g, '');
    if (style.includes('display:none') || style.includes('visibility:hidden')) $(el).remove();
  });

  const anchors: Visible['anchors'] = [];
  const seen = new Set<string>();
  $('a[href]').each((_, el) => {
    try {
      const u = new URL($(el).attr('href') ?? '', baseUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
      u.hash = '';
      const url = u.toString();
      if (!seen.has(url)) { seen.add(url); anchors.push({ url, text: $(el).text().replace(/\s+/g, ' ').trim() }); }
    } catch {
      /* href inválido: se ignora */
    }
  });

  $('br').replaceWith('\n');
  $(BLOCKS).each((_, el) => { $(el).append('\n'); });
  const raw = $('body').length ? $('body').text() : $.root().text();
  const text = raw.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  return { title, text, links: anchors.map((a) => a.url), anchors };
}
