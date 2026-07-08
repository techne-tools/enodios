import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plugin } from '../Plugin.ts';

// Define window on global for Node environment test execution
if (typeof window === 'undefined') {
  (global as any).window = global;
}

// Mock obsidian module
vi.mock('obsidian', () => ({
  TFile: class TFile {
    extension = 'pdf';
    path = '';
    basename = '';
    constructor(path: string) {
      this.path = path;
      this.extension = path.split('.').pop() || 'pdf';
      this.basename = path.split('/').pop()?.replace('.pdf', '') || '';
    }
  }
}));

import { PDFAnnotationManager } from '../PDFAnnotationManager.ts';

// Mock Plugin
const makeMockPlugin = () => {
  return {
    app: {
      vault: {
        readBinary: vi.fn()
      }
    },
    debug: {
      error: vi.fn(),
      log: vi.fn()
    }
  } as unknown as Plugin;
};

describe('PDFAnnotationManager', () => {
  beforeEach(() => {
    // Setup mock window.pdfjsLib
    (window as any).pdfjsLib = {
      getDocument: vi.fn().mockReturnValue({
        promise: Promise.resolve({
          numPages: 1,
          getMetadata: vi.fn().mockResolvedValue({
            info: {
              Title: 'Mock PDF Title',
              Author: 'John Doe',
              Subject: 'Testing PDFs'
            }
          }),
          getPage: vi.fn().mockResolvedValue({
            getAnnotations: vi.fn().mockResolvedValue([
              {
                contents: 'This is a test comment',
                id: 'annot1',
                subtype: 'Highlight',
                rect: [10, 20, 100, 40],
                color: [255, 255, 0] // Yellow
              },
              {
                contents: 'Another comment',
                id: 'annot2',
                subtype: 'Text', // Sticky note
                rect: [0, 0, 0, 0]
              }
            ]),
            getTextContent: vi.fn().mockResolvedValue({
              items: [
                {
                  str: 'Highlighted text content',
                  width: 50,
                  transform: [1, 0, 0, 1, 15, 25] // fits within rect [10, 20, 100, 40]
                },
                {
                  str: 'Non-highlighted text',
                  width: 50,
                  transform: [1, 0, 0, 1, 200, 200]
                }
              ]
            })
          })
        })
      })
    };
  });

  afterEach(() => {
    delete (window as any).pdfjsLib;
  });

  it('should extract Highlight and Text annotations mapping highlighted text', async () => {
    const plugin = makeMockPlugin();
    const manager = new PDFAnnotationManager(plugin);
    const mockFile: any = { extension: 'pdf', path: 'paper.pdf', basename: 'paper' };

    plugin.app.vault.readBinary = vi.fn().mockResolvedValue(new ArrayBuffer(10));

    const result = await manager.extractAnnotations(mockFile);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      color: 'Yellow',
      comment: 'This is a test comment',
      id: 'annot1',
      page: 1,
      text: 'Highlighted text content',
      type: 'highlight'
    });

    expect(result[1]).toEqual({
      color: undefined,
      comment: 'Another comment',
      id: 'annot2',
      page: 1,
      text: '',
      type: 'text'
    });
  });

  it('should format annotations into clean markdown', () => {
    const plugin = makeMockPlugin();
    const manager = new PDFAnnotationManager(plugin);

    const annotations = [
      {
        color: 'Yellow',
        comment: 'Important point',
        id: '1',
        page: 1,
        text: 'This is the main thesis.',
        type: 'highlight'
      },
      {
        comment: 'Interesting note',
        id: '2',
        page: 2,
        text: '',
        type: 'text'
      }
    ];

    const markdown = manager.formatAnnotationsMarkdown(annotations, 'test.pdf');
    expect(markdown).toContain('### 📄 PDF Annotations: test.pdf');
    expect(markdown).toContain('#### Page 1');
    expect(markdown).toContain('> **[HIGHLIGHT (Yellow)]** This is the main thesis.');
    expect(markdown).toContain('* **Note:** Important point');
    expect(markdown).toContain('#### Page 2');
    expect(markdown).toContain('* **Note:** Interesting note');
  });

  it('should extract page text', async () => {
    const plugin = makeMockPlugin();
    const manager = new PDFAnnotationManager(plugin);
    const mockFile: any = { extension: 'pdf', path: 'paper.pdf', basename: 'paper' };

    plugin.app.vault.readBinary = vi.fn().mockResolvedValue(new ArrayBuffer(10));

    const text = await manager.extractPageText(mockFile, 1);
    expect(text).toBe('Highlighted text content Non-highlighted text');
  });

  it('should extract document metadata', async () => {
    const plugin = makeMockPlugin();
    const manager = new PDFAnnotationManager(plugin);
    const mockFile: any = { extension: 'pdf', path: 'paper.pdf', basename: 'paper' };

    plugin.app.vault.readBinary = vi.fn().mockResolvedValue(new ArrayBuffer(10));

    const metadata = await manager.extractMetadata(mockFile);
    expect(metadata).toEqual({
      Title: 'Mock PDF Title',
      Author: 'John Doe',
      Subject: 'Testing PDFs'
    });
  });
});
