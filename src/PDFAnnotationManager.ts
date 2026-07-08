import { TFile } from 'obsidian';
import type { Plugin } from './Plugin.ts';

export interface AnnotationData {
  id: string;
  page: number;
  type: string;
  text: string;      // The text that was highlighted/underlined
  comment?: string | undefined;  // The user's note/comment on the annotation
  color?: string | undefined;    // Hex color string or name
}

/**
 * Manages PDF annotation extraction using Obsidian's built-in PDF.js.
 */
export class PDFAnnotationManager {
  private readonly plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Extract annotations from a PDF file in the vault.
   */
  public async extractAnnotations(file: TFile): Promise<AnnotationData[]> {
    if (file.extension !== 'pdf') {
      throw new Error('File is not a PDF');
    }

    // Access the built-in PDF.js library in Obsidian
    const pdfjs = typeof window !== 'undefined' ? (window as any).pdfjsLib : (global as any).pdfjsLib;
    if (!pdfjs) {
      throw new Error('Obsidian PDF.js library is not available in this environment.');
    }

    const binaryData = await this.plugin.app.vault.readBinary(file);
    const loadingTask = pdfjs.getDocument({ data: binaryData });
    const pdfDoc = await loadingTask.promise;
    const annotations: AnnotationData[] = [];

    for (let pNum = 1; pNum <= pdfDoc.numPages; pNum++) {
      try {
        const page = await pdfDoc.getPage(pNum);
        const rawAnnots = await page.getAnnotations();
        if (!rawAnnots || rawAnnots.length === 0) continue;

        // Retrieve text content to map coordinates for highlights/underlines
        const textContent = await page.getTextContent();
        const textItems = textContent.items.map((item: any) => {
          const transform = item.transform; // [scaleX, skewX, skewY, scaleY, x, y]
          const x = transform[4];
          const y = transform[5];
          const fontSize = Math.abs(transform[3]) || 10;
          return {
            x,
            y,
            width: item.width || (item.str.length * fontSize * 0.6),
            height: fontSize,
            str: item.str
          };
        });

        for (const annot of rawAnnots) {
          const type = annot.subtype; // e.g. 'Highlight', 'Underline', 'StrikeOut', 'Text'
          if (!['Highlight', 'StrikeOut', 'Text', 'Underline'].includes(type)) {
            continue;
          }

          const id = annot.id || `annot-${pNum}-${Math.random().toString(36).slice(2, 9)}`;
          const comment = annot.contents ? String(annot.contents).trim() : undefined;
          const color = this.formatColor(annot.color);

          let text = '';
          if (type !== 'Text' && annot.rect) {
            // Rect is [minX, minY, maxX, maxY]
            const rect = annot.rect;
            const tolerance = 2.0;

            // Find overlapping text items
            // Find overlapping text items
            const overlapping = textItems.filter((item: { x: number; y: number; width: number; height: number; str: string }) => {
              const itemMinX = item.x;
              const itemMaxX = item.x + item.width;
              const itemMinY = item.y;
              const itemMaxY = item.y + item.height;

              return (
                itemMinX < rect[2] + tolerance &&
                itemMaxX > rect[0] - tolerance &&
                itemMinY < rect[3] + tolerance &&
                itemMaxY > rect[1] - tolerance
              );
            });

            // Sort text items: vertical position descending, then horizontal ascending
            overlapping.sort((a: { x: number; y: number; width: number; height: number; str: string }, b: { x: number; y: number; width: number; height: number; str: string }) => {
              if (Math.abs(a.y - b.y) > tolerance) {
                return b.y - a.y; // top to bottom
              }
              return a.x - a.x; // left to right
            });

            text = overlapping.map((it: { x: number; y: number; width: number; height: number; str: string }) => it.str).join(' ').replace(/\s+/g, ' ').trim();
          }

          annotations.push({
            color,
            comment,
            id,
            page: pNum,
            text,
            type: type.toLowerCase()
          });
        }
      } catch (err) {
        this.plugin.debug.error(`Failed to parse annotations on page ${pNum} of ${file.path}`, err);
      }
    }

    return annotations.sort((a, b) => a.page - b.page);
  }

  /**
   * Formats extracted annotations into a markdown block.
   */
  public formatAnnotationsMarkdown(annotations: AnnotationData[], filename: string): string {
    if (annotations.length === 0) {
      return `No annotations found in **${filename}**.`;
    }

    let markdown = `### 📄 PDF Annotations: ${filename}\n\n`;
    let currentPage = -1;

    for (const annot of annotations) {
      if (annot.page !== currentPage) {
        currentPage = annot.page;
        markdown += `#### Page ${currentPage}\n\n`;
      }

      const typeLabel = annot.type.toUpperCase();
      const colorIndicator = annot.color ? ` (${annot.color})` : '';

      if (annot.text) {
        markdown += `> **[${typeLabel}${colorIndicator}]** ${annot.text}\n`;
      }

      if (annot.comment) {
        markdown += `* **Note:** ${annot.comment}\n`;
      }

      markdown += '\n';
    }

    return markdown.trim();
  }

  /**
   * Helper: formats PDF color array [r, g, b] to a hex string or readable color name.
   */
  private formatColor(colorArray: any): string | undefined {
    if (!colorArray || !Array.isArray(colorArray) || colorArray.length < 3) {
      return undefined;
    }

    const r = Math.round(colorArray[0]);
    const g = Math.round(colorArray[1]);
    const b = Math.round(colorArray[2]);

    // Map common colors to readable names for better display
    if (r > 200 && g > 200 && b < 100) return 'Yellow';
    if (r < 100 && g > 200 && b < 100) return 'Green';
    if (r < 100 && g < 150 && b > 200) return 'Blue';
    if (r > 200 && g < 100 && b < 100) return 'Red';
    if (r > 200 && g < 100 && b > 200) return 'Magenta';
    if (r > 200 && g > 120 && b < 50)  return 'Orange';

    // Hex fallback
    const toHex = (c: number) => {
      const hex = Math.min(255, Math.max(0, c)).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  /**
   * Extract plain text from a specific page of a PDF file.
   */
  public async extractPageText(file: TFile, pageNumber: number): Promise<string> {
    if (file.extension !== 'pdf') {
      throw new Error('File is not a PDF');
    }

    const pdfjs = typeof window !== 'undefined' ? (window as any).pdfjsLib : (global as any).pdfjsLib;
    if (!pdfjs) {
      throw new Error('Obsidian PDF.js library is not available in this environment.');
    }

    const arrayBuffer = await this.plugin.app.vault.readBinary(file);
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

    if (pageNumber < 1 || pageNumber > pdf.numPages) {
      throw new Error(`Page number ${pageNumber} is out of bounds (1-${pdf.numPages})`);
    }

    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const textItems = textContent.items.map((item: any) => item.str);
    return textItems.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Extract document metadata from a PDF file.
   */
  public async extractMetadata(file: TFile): Promise<Record<string, string>> {
    if (file.extension !== 'pdf') {
      throw new Error('File is not a PDF');
    }

    const pdfjs = typeof window !== 'undefined' ? (window as any).pdfjsLib : (global as any).pdfjsLib;
    if (!pdfjs) {
      throw new Error('Obsidian PDF.js library is not available in this environment.');
    }

    const arrayBuffer = await this.plugin.app.vault.readBinary(file);
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const meta = await pdf.getMetadata();

    const info: Record<string, string> = {};
    if (meta?.info) {
      const keys = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate'];
      keys.forEach((key) => {
        if (meta.info[key]) {
          info[key] = String(meta.info[key]);
        }
      });
    }
    return info;
  }
}
