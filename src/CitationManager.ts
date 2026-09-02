import { TFile } from 'obsidian';
import type { Plugin } from './Plugin.ts';

export interface CitationItem {
  key: string;
  type: string;
  title: string;
  author: string;
  year: string;
  journal?: string | undefined;
  publisher?: string | undefined;
  booktitle?: string | undefined;
  volume?: string | undefined;
  number?: string | undefined;
  pages?: string | undefined;
  doi?: string | undefined;
  url?: string | undefined;
}

interface CslAuthor {
  family?: string | undefined;
  given?: string | undefined;
  literal?: string | undefined;
  name?: string | undefined;
}

interface CslJsonItem {
  id?: unknown;
  key?: unknown;
  type?: unknown;
  title?: unknown;
  author?: CslAuthor[] | string | undefined;
  issued?:
    | {
      'date-parts'?: unknown[][] | undefined;
      raw?: unknown;
    }
    | undefined;
  'container-title'?: unknown;
  DOI?: unknown;
  issue?: unknown;
  number?: unknown;
  page?: unknown;
  publisher?: unknown;
  URL?: unknown;
}

/**
 * Manages citation loading, searching, and formatting (APA, MLA, Chicago, IEEE).
 */
export class CitationManager {
  private readonly plugin: Plugin;
  private bibliographyCache: CitationItem[] = [];
  private lastLoadedPath = '';
  private lastLoadedMtime = 0;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Load bibliography file from vault settings.
   */
  public async loadBibliography(): Promise<CitationItem[]> {
    const bibPath = this.plugin.settings.bibliographyPath;
    if (!bibPath) {
      this.bibliographyCache = [];
      return [];
    }

    const file = this.plugin.app.vault.getAbstractFileByPath(bibPath);
    if (!(file instanceof TFile)) {
      this.bibliographyCache = [];
      return [];
    }

    // Cache hit check
    if (
      this.lastLoadedPath === file.path
      && this.lastLoadedMtime === file.stat.mtime
    ) {
      return this.bibliographyCache;
    }

    try {
      const content = await this.plugin.app.vault.read(file);
      if (file.extension === 'json') {
        this.bibliographyCache = this.parseCSLJson(content);
      } else {
        this.bibliographyCache = this.parseBibTeX(content);
      }
      this.lastLoadedPath = file.path;
      this.lastLoadedMtime = file.stat.mtime;
      this.plugin.debug.info(
        `Loaded ${String(this.bibliographyCache.length)} citations from ${bibPath}`
      );
    } catch (err) {
      this.plugin.debug.error(
        `Failed to load bibliography from ${bibPath}`,
        err
      );
      this.bibliographyCache = [];
    }

    return this.bibliographyCache;
  }

  /**
   * Search bibliography for items matching query.
   */
  public search(query: string): CitationItem[] {
    const term = query.toLowerCase().trim();
    if (!term) return this.bibliographyCache.slice(0, 10);

    return this.bibliographyCache.filter(
      (item) =>
        item.key.toLowerCase().includes(term)
        || item.title.toLowerCase().includes(term)
        || item.author.toLowerCase().includes(term)
        || item.year.includes(term)
    );
  }

  /**
   * Format in-text citation for a key.
   */
  public generateCitation(key: string, style: string, index = 1): string {
    const item = this.bibliographyCache.find((it) => it.key === key);
    if (!item) {
      return `[@${key}]`;
    }

    const authors = this.parseAuthorNames(item.author);
    const year = item.year || 'n.d.';

    switch (style.toLowerCase()) {
      case 'chicago': {
        const authorStr = this.formatChicagoAuthors(authors);
        return `(${authorStr} ${year})`;
      }
      case 'harvard': {
        const authorStr = this.formatApaAuthors(authors);
        return `(${authorStr}, ${year})`;
      }
      case 'ieee':
        return `[${String(index)}]`;
      case 'mla': {
        const authorStr = this.formatMlaAuthors(authors);
        return `(${authorStr})`;
      }
      case 'apa':
      default: {
        const authorStr = this.formatApaAuthors(authors);
        return `(${authorStr}, ${year})`;
      }
    }
  }

  /**
   * Format the bibliography list.
   */
  public generateBibliography(keys: string[], style: string): string {
    const uniqueKeys = Array.from(new Set(keys));
    const items = uniqueKeys
      .map((key) => this.bibliographyCache.find((it) => it.key === key))
      .filter((it): it is CitationItem => !!it);

    if (items.length === 0) return '';

    // Sort: IEEE by order of appearance, others alphabetically by author last name
    if (style.toLowerCase() !== 'ieee') {
      items.sort((a, b) => {
        const authA = a.author.toLowerCase();
        const authB = b.author.toLowerCase();
        if (authA < authB) return -1;
        if (authA > authB) return 1;
        return a.year.localeCompare(b.year);
      });
    }

    let result = '';
    items.forEach((item, idx) => {
      const formatted = this.formatBibliographyItem(item, style, idx + 1);
      result += formatted + '\n\n';
    });

    return result.trim();
  }

  /**
   * Scans document text for `[@citation-key]` references, formats them and appends a bibliography.
   */
  public generateBibliographyForContent(
    content: string,
    style: string
  ): string {
    const citationRegex = /\[\s*@([^\]]+)\s*\]/g;
    const keys: string[] = [];
    let match;

    while ((match = citationRegex.exec(content)) !== null) {
      const rawKey = match[1] ?? '';
      // Split by semicolon if multiple citations like [@key1; @key2]
      const parts = rawKey.split(';').map((p) => p.replace(/^\s*@/, '').trim());
      keys.push(...parts);
    }

    if (keys.length === 0) return '';

    const bibContent = this.generateBibliography(keys, style);
    if (!bibContent) return '';

    return `\n\n## References\n\n${bibContent}`;
  }

  /**
   * Parse BibTeX format.
   */
  private parseBibTeX(content: string): CitationItem[] {
    const items: CitationItem[] = [];
    const entryRegex = /@([a-zA-Z]+)\s*\{\s*([^,\s}]+)\s*,/g;
    let match;

    while ((match = entryRegex.exec(content)) !== null) {
      const type = (match[1] ?? '').toLowerCase();
      const key = match[2] ?? '';

      let braceCount = 1;
      let pos = entryRegex.lastIndex;
      let entryText = '';

      while (pos < content.length && braceCount > 0) {
        const char = content[pos];
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
        }
        if (braceCount > 0) {
          entryText += char ?? '';
        }
        pos++;
      }

      const fields: Record<string, string> = {};
      let fieldPos = 0;
      while (fieldPos < entryText.length) {
        const eqIdx = entryText.indexOf('=', fieldPos);
        if (eqIdx === -1) break;

        const fieldName = entryText
          .substring(fieldPos, eqIdx)
          .trim()
          .toLowerCase();
        let valStart = eqIdx + 1;
        while (
          valStart < entryText.length
          && /\s/.test(entryText[valStart] ?? '')
        ) {
          valStart++;
        }

        let val = '';
        let valEnd: number;
        const valStartChar = entryText[valStart];
        if (valStartChar === '{') {
          let bCount = 1;
          valEnd = valStart + 1;
          while (valEnd < entryText.length && bCount > 0) {
            const c = entryText[valEnd];
            if (c === '{') bCount++;
            else if (c === '}') bCount--;
            if (bCount > 0) val += c ?? '';
            valEnd++;
          }
        } else if (valStartChar === '"') {
          valEnd = valStart + 1;
          while (valEnd < entryText.length && entryText[valEnd] !== '"') {
            val += entryText[valEnd] ?? '';
            valEnd++;
          }
          valEnd++;
        } else {
          valEnd = valStart;
          while (
            valEnd < entryText.length
            && entryText[valEnd] !== ','
            && entryText[valEnd] !== '\n'
          ) {
            val += entryText[valEnd] ?? '';
            valEnd++;
          }
        }

        if (fieldName) {
          fields[fieldName] = val.trim();
        }

        const commaIdx = entryText.indexOf(',', valEnd);
        if (commaIdx !== -1) {
          fieldPos = commaIdx + 1;
        } else {
          break;
        }
      }

      const author = fields['author']
        ? this.cleanBibTeXString(fields['author'])
        : '';
      const title = fields['title']
        ? this.cleanBibTeXString(fields['title'])
        : '';
      const year = fields['year'] ? this.cleanBibTeXString(fields['year']) : '';
      const journal = fields['journal']
        ? this.cleanBibTeXString(fields['journal'])
        : fields['journaltitle']
        ? this.cleanBibTeXString(fields['journaltitle'])
        : undefined;
      const publisher = fields['publisher']
        ? this.cleanBibTeXString(fields['publisher'])
        : undefined;
      const booktitle = fields['booktitle']
        ? this.cleanBibTeXString(fields['booktitle'])
        : undefined;
      const volume = fields['volume']
        ? this.cleanBibTeXString(fields['volume'])
        : undefined;
      const number = fields['number']
        ? this.cleanBibTeXString(fields['number'])
        : undefined;
      const pages = fields['pages']
        ? this.cleanBibTeXString(fields['pages'])
        : undefined;
      const doi = fields['doi']
        ? this.cleanBibTeXString(fields['doi'])
        : undefined;
      const url = fields['url']
        ? this.cleanBibTeXString(fields['url'])
        : undefined;

      items.push({
        author,
        booktitle,
        doi,
        journal,
        key,
        number,
        pages,
        publisher,
        title,
        type,
        url,
        volume,
        year
      });

      entryRegex.lastIndex = pos;
    }

    return items;
  }

  private cleanBibTeXString(str: string): string {
    let val = str;
    val = val.replace(/\\"[{}a-zA-Z]/g, (m) => m[m.length - 1] ?? '');
    val = val.replace(/\\'[{}a-zA-Z]/g, (m) => m[m.length - 1] ?? '');
    val = val.replace(/\\`[{}a-zA-Z]/g, (m) => m[m.length - 1] ?? '');
    val = val.replace(/\\^[{}a-zA-Z]/g, (m) => m[m.length - 1] ?? '');
    val = val.replace(/\\~[{}a-zA-Z]/g, (m) => m[m.length - 1] ?? '');
    val = val.replace(/\\=/g, '');
    val = val.replace(/\\./g, '');
    val = val.replace(/[{}\\]/g, '');
    return val.trim();
  }

  /**
   * Parse CSL JSON format.
   */
  private parseCSLJson(content: string): CitationItem[] {
    try {
      const data: unknown = JSON.parse(content);
      if (!Array.isArray(data)) return [];

      return data.map((rawItem) => {
        const item = rawItem as CslJsonItem;
        const key = toSafeString(item.id ?? item.key);
        const type = toSafeString(item.type);
        const title = toSafeString(item.title);

        let author = '';
        if (Array.isArray(item.author)) {
          author = item.author
            .map((a) => {
              if (a.family && a.given) return `${a.family}, ${a.given}`;
              return a.literal ?? a.family ?? a.name ?? '';
            })
            .filter(Boolean)
            .join(' and ');
        } else if (typeof item.author === 'string') {
          author = item.author;
        }

        let year = '';
        if (
          item.issued
          && Array.isArray(item.issued['date-parts'])
          && item.issued['date-parts'][0]
        ) {
          year = toSafeString(item.issued['date-parts'][0][0]);
        } else if (item.issued && typeof item.issued.raw === 'string') {
          const m = /\b\d{4}\b/.exec(item.issued.raw);
          if (m) year = m[0];
        }

        return {
          author,
          booktitle: item['container-title'] && type !== 'article-journal'
            ? toSafeString(item['container-title'])
            : undefined,
          doi: item.DOI ? toSafeString(item.DOI) : undefined,
          journal: item['container-title'] && type === 'article-journal'
            ? toSafeString(item['container-title'])
            : undefined,
          key,
          number: (item.issue ?? item.number)
            ? toSafeString(item.issue ?? item.number)
            : undefined,
          pages: item.page ? toSafeString(item.page) : undefined,
          publisher: item.publisher ? toSafeString(item.publisher) : undefined,
          title,
          type,
          url: item.URL ? toSafeString(item.URL) : undefined,
          year
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Parse authors string (e.g. "Smith, John and Doe, Jane") into array of objects.
   */
  private parseAuthorNames(
    authorStr: string
  ): { first: string; last: string }[] {
    if (!authorStr) return [];
    return authorStr.split(/\s+and\s+/i).map((part) => {
      const commaIdx = part.indexOf(',');
      if (commaIdx !== -1) {
        return {
          first: part.substring(commaIdx + 1).trim(),
          last: part.substring(0, commaIdx).trim()
        };
      }
      const parts = part.trim().split(/\s+/);
      const last = parts.pop() ?? '';
      const first = parts.join(' ');
      return { first, last };
    });
  }

  private formatApaAuthors(authors: { first: string; last: string }[]): string {
    if (authors.length === 0) return 'n.a.';
    if (authors.length === 1) return authors[0]?.last ?? '';
    if (authors.length === 2) {
      return `${authors[0]?.last ?? ''} & ${authors[1]?.last ?? ''}`;
    }
    return `${authors[0]?.last ?? ''} et al.`;
  }

  private formatMlaAuthors(authors: { first: string; last: string }[]): string {
    if (authors.length === 0) return 'n.a.';
    if (authors.length === 1) return authors[0]?.last ?? '';
    if (authors.length === 2) {
      return `${authors[0]?.last ?? ''} and ${authors[1]?.last ?? ''}`;
    }
    return `${authors[0]?.last ?? ''} et al.`;
  }

  private formatChicagoAuthors(
    authors: { first: string; last: string }[]
  ): string {
    return this.formatMlaAuthors(authors); // Chicago author-date is identical to MLA for short citations
  }

  /**
   * Formats a single bibliography item.
   */
  private formatBibliographyItem(
    item: CitationItem,
    style: string,
    index: number
  ): string {
    const authors = this.parseAuthorNames(item.author);
    const year = item.year || 'n.d.';
    const title = item.title;
    const journal = item.journal;
    const booktitle = item.booktitle;
    const publisher = item.publisher;
    const volume = item.volume;
    const number = item.number;
    const pages = item.pages;
    const doi = item.doi;
    const url = item.url;

    // Helper: format names for bibliography
    const formatFullAuthors = (styleName: string) => {
      if (authors.length === 0) return 'Unknown Author';
      if (styleName === 'apa') {
        const formatted = authors.map((a) => {
          const init = a.first
            ? a.first
              .split(/\s+/)
              .map((n) => (n[0] ?? '') + '.')
              .join(' ')
            : '';
          return `${a.last}, ${init}`;
        });
        if (formatted.length === 1) return formatted[0] ?? '';
        if (formatted.length === 2) {
          return `${formatted[0] ?? ''}, & ${formatted[1] ?? ''}`;
        }
        return `${formatted.slice(0, -1).join(', ')}, & ${formatted[formatted.length - 1] ?? ''}`;
      }
      // MLA / Chicago / IEEE style full authors
      const formatted = authors.map((a, i) => {
        if (i === 0) return `${a.last}, ${a.first}`;
        return `${a.first} ${a.last}`;
      });
      if (formatted.length === 1) return formatted[0] ?? '';
      if (formatted.length === 2) {
        return `${formatted[0] ?? ''} and ${formatted[1] ?? ''}`;
      }
      return `${formatted.slice(0, -1).join(', ')}, and ${formatted[formatted.length - 1] ?? ''}`;
    };

    switch (style.toLowerCase()) {
      case 'chicago': {
        // Chicago: Last, First. Year. "Title." Journal Volume (Number): Pages.
        let main = `${formatFullAuthors('chicago')}. ${year}. "${title}." `;
        if (journal) {
          main += `*${journal}* `;
          if (volume) {
            main += volume;
            if (number) main += ` (${number})`;
          }
          if (pages) main += `: ${pages}`;
          main += '.';
        } else if (booktitle) {
          main += `In *${booktitle}*, `;
          if (publisher) main += publisher;
          if (pages) main += `, ${pages}`;
          main += '.';
        } else {
          if (publisher) main += `${publisher}.`;
        }
        if (doi) main += ` https://doi.org/${doi}`;
        else if (url) main += ` ${url}`;
        return main;
      }
      case 'ieee': {
        // IEEE bibliography item format: [1] F. M. Last, "Title," Journal, vol. X, no. Y, pp. Z, Year.
        const formattedIEEE = authors.map((a) => {
          const init = a.first
            ? a.first
              .split(/\s+/)
              .map((n) => (n[0] ?? '') + '.')
              .join(' ')
            : '';
          return `${init} ${a.last}`;
        });
        let ieeeAuthors = '';
        if (formattedIEEE.length === 1) ieeeAuthors = formattedIEEE[0] ?? '';
        else if (formattedIEEE.length === 2) {
          ieeeAuthors = `${formattedIEEE[0] ?? ''} and ${formattedIEEE[1] ?? ''}`;
        } else if (formattedIEEE.length > 2) {
          ieeeAuthors = `${formattedIEEE.slice(0, -1).join(', ')}, and ${formattedIEEE[formattedIEEE.length - 1] ?? ''}`;
        }
        let main = `[${String(index)}] ${ieeeAuthors || 'Unknown Author'}, "${title}," `;
        if (journal) main += `*${journal}*, `;
        else if (booktitle) main += `in *${booktitle}*, `;
        if (volume) main += `vol. ${volume}, `;
        if (number) main += `no. ${number}, `;
        if (pages) main += `pp. ${pages}, `;
        main += `${year}.`;
        if (doi) main += ` DOI: ${doi}.`;
        if (url) main += ` Available: ${url}.`;
        return main;
      }
      case 'apa':
      case 'harvard':
      default: {
        // Harvard / APA: Author, A. A. (Year). Title. Journal, Volume(Issue), pages.
        let main = `${formatFullAuthors('apa')} (${year}). ${title}. `;
        if (journal) {
          main += `*${journal}*`;
          if (volume) {
            main += `, *${volume}*`;
            if (number) main += `(${number})`;
          }
          if (pages) main += `, ${pages}`;
          main += '.';
        } else if (booktitle) {
          main += `In *${booktitle}*`;
          if (pages) main += ` (pp. ${pages})`;
          main += `. `;
          if (publisher) main += `${publisher}.`;
        } else {
          if (publisher) main += `${publisher}.`;
        }
        if (doi) main += ` https://doi.org/${doi}`;
        else if (url) main += ` ${url}`;
        return main;
      }
    }
  }
}

/**
 * Safely stringify an unknown value, returning '' for null/undefined/objects.
 */
function toSafeString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}
