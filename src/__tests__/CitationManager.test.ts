import { describe, expect, it, vi } from 'vitest';
import type { Plugin } from '../Plugin.ts';

// Mock obsidian module
vi.mock('obsidian', () => ({
  TFile: class TFile {
    extension = 'bib';
    path = '';
    stat = { mtime: 123456 };
    constructor(path: string) {
      this.path = path;
      this.extension = path.split('.').pop() || 'bib';
    }
  }
}));

import { CitationManager } from '../CitationManager.ts';

// Mock Plugin
const makeMockPlugin = (settings: any = {}) => {
  return {
    app: {
      vault: {
        getAbstractFileByPath: vi.fn(),
        read: vi.fn()
      }
    },
    debug: {
      log: vi.fn(),
      error: vi.fn()
    },
    settings: {
      bibliographyPath: 'references.bib',
      citationStyle: 'apa',
      ...settings
    }
  } as unknown as Plugin;
};

describe('CitationManager', () => {
  describe('BibTeX Parsing', () => {
    it('should parse basic BibTeX entries', () => {
      const plugin = makeMockPlugin();
      const manager = new CitationManager(plugin);

      const content = `
@article{smith2020,
  author = {Smith, John and Doe, Jane},
  title = {A Great Study on AI},
  journal = {Journal of AI},
  year = {2020},
  volume = {12},
  number = {3},
  pages = {123-145}
}

@book{jones2018,
  author = {Jones, Bob},
  title = {Introduction to Code},
  publisher = {Tech Press},
  year = {2018}
}
      `;

      // @ts-expect-error - accessing private method for testing
      const parsed = manager.parseBibTeX(content);
      expect(parsed).toHaveLength(2);

      expect(parsed[0]).toEqual({
        author: 'Smith, John and Doe, Jane',
        booktitle: undefined,
        doi: undefined,
        journal: 'Journal of AI',
        key: 'smith2020',
        number: '3',
        pages: '123-145',
        publisher: undefined,
        title: 'A Great Study on AI',
        type: 'article',
        url: undefined,
        volume: '12',
        year: '2020'
      });

      expect(parsed[1]).toEqual({
        author: 'Jones, Bob',
        booktitle: undefined,
        doi: undefined,
        journal: undefined,
        key: 'jones2018',
        number: undefined,
        pages: undefined,
        publisher: 'Tech Press',
        title: 'Introduction to Code',
        type: 'book',
        url: undefined,
        volume: undefined,
        year: '2018'
      });
    });
  });

  describe('CSL JSON Parsing', () => {
    it('should parse CSL JSON entries', () => {
      const plugin = makeMockPlugin();
      const manager = new CitationManager(plugin);

      const content = JSON.stringify([
        {
          id: 'smith2020',
          type: 'article-journal',
          title: 'A Great Study on AI',
          author: [
            { family: 'Smith', given: 'John' },
            { family: 'Doe', given: 'Jane' }
          ],
          'container-title': 'Journal of AI',
          issued: {
            'date-parts': [['2020']]
          },
          issue: '3',
          page: '123-145'
        }
      ]);

      // @ts-expect-error - accessing private method for testing
      const parsed = manager.parseCSLJson(content);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toEqual({
        author: 'Smith, John and Doe, Jane',
        booktitle: undefined,
        doi: undefined,
        journal: 'Journal of AI',
        key: 'smith2020',
        number: '3',
        pages: '123-145',
        publisher: undefined,
        title: 'A Great Study on AI',
        type: 'article-journal',
        url: undefined,
        year: '2020'
      });
    });
  });

  describe('Citation Generation', () => {
    const bibData = [
      {
        author: 'Smith, John and Doe, Jane',
        key: 'smith2020',
        title: 'A Great Study on AI',
        type: 'article',
        year: '2020'
      },
      {
        author: 'Jones, Bob and Miller, Alice and Davis, Charlie',
        key: 'jones2018',
        title: 'Introduction to Code',
        type: 'book',
        year: '2018'
      }
    ];

    it('should format APA in-text citations', () => {
      const plugin = makeMockPlugin({ citationStyle: 'apa' });
      const manager = new CitationManager(plugin);
      // @ts-expect-error - seeding cache
      manager.bibliographyCache = bibData;

      expect(manager.generateCitation('smith2020', 'apa')).toBe('(Smith & Doe, 2020)');
      expect(manager.generateCitation('jones2018', 'apa')).toBe('(Jones et al., 2018)');
    });

    it('should format MLA in-text citations', () => {
      const plugin = makeMockPlugin({ citationStyle: 'mla' });
      const manager = new CitationManager(plugin);
      // @ts-expect-error - seeding cache
      manager.bibliographyCache = bibData;

      expect(manager.generateCitation('smith2020', 'mla')).toBe('(Smith and Doe)');
      expect(manager.generateCitation('jones2018', 'mla')).toBe('(Jones et al.)');
    });

    it('should format IEEE in-text citations', () => {
      const plugin = makeMockPlugin({ citationStyle: 'ieee' });
      const manager = new CitationManager(plugin);
      // @ts-expect-error - seeding cache
      manager.bibliographyCache = bibData;

      expect(manager.generateCitation('smith2020', 'ieee', 2)).toBe('[2]');
    });
  });

  describe('Bibliography Formatting', () => {
    const bibData = [
      {
        author: 'Smith, John and Doe, Jane',
        journal: 'Journal of AI',
        key: 'smith2020',
        pages: '123-145',
        title: 'A Great Study on AI',
        type: 'article',
        volume: '12',
        year: '2020'
      },
      {
        author: 'Jones, Bob',
        key: 'jones2018',
        publisher: 'Tech Press',
        title: 'Introduction to Code',
        type: 'book',
        year: '2018'
      }
    ];

    it('should format APA bibliography', () => {
      const plugin = makeMockPlugin({ citationStyle: 'apa' });
      const manager = new CitationManager(plugin);
      // @ts-expect-error - seeding cache
      manager.bibliographyCache = bibData;

      const result = manager.generateBibliography(['smith2020', 'jones2018'], 'apa');
      expect(result).toContain('Jones, B. (2018). Introduction to Code.');
      expect(result).toContain('Smith, J., & Doe, J. (2020). A Great Study on AI. *Journal of AI*, *12*, 123-145.');
    });

    it('should format IEEE bibliography', () => {
      const plugin = makeMockPlugin({ citationStyle: 'ieee' });
      const manager = new CitationManager(plugin);
      // @ts-expect-error - seeding cache
      manager.bibliographyCache = bibData;

      const result = manager.generateBibliography(['smith2020', 'jones2018'], 'ieee');
      expect(result).toContain('[1] J. Smith and J. Doe, "A Great Study on AI," *Journal of AI*, vol. 12, pp. 123-145, 2020.');
      expect(result).toContain('[2] B. Jones, "Introduction to Code," 2018.');
    });
  });

  describe('Scan and Append Bibliography', () => {
    const bibData = [
      {
        author: 'Smith, John',
        key: 'smith2020',
        title: 'AI Today',
        type: 'book',
        year: '2020'
      }
    ];

    it('should append a references section if [@key] is found', () => {
      const plugin = makeMockPlugin({ citationStyle: 'apa' });
      const manager = new CitationManager(plugin);
      // @ts-expect-error - seeding cache
      manager.bibliographyCache = bibData;

      const content = 'This is a test sentence [@smith2020].';
      const result = manager.generateBibliographyForContent(content, 'apa');

      expect(result).toContain('## References');
      expect(result).toContain('Smith, J. (2020). AI Today.');
    });
  });
});
