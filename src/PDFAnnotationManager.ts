import { TFile } from 'obsidian';
import type { Plugin } from './Plugin.ts';

export interface AnnotationData {
  id: string;
  page: number;
  type: string;
  text: string; // The text that was highlighted/underlined
  comment?: string | undefined; // The user's note/comment on the annotation
  color?: string | undefined; // Hex color string or name
}

/**
 * Minimal typed surface for the PDF.js API used by this manager.
 * Obsidian exposes `window.pdfjsLib` at runtime; we model only the members
 * we actually consume so the rest stays `unknown` and safe.
 */
interface PdfJsLib {
  getDocument(params: { data: ArrayBuffer | Uint8Array }): PdfLoadingTask;
}

interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  getMetadata(): Promise<PdfMetadata>;
}

interface PdfPage {
  getAnnotations(): Promise<unknown[]>;
  getTextContent(): Promise<PdfTextContent>;
}

interface PdfTextContent {
  items: PdfTextItem[];
}

interface PdfTextItem {
  str: string;
  width?: number | undefined;
  transform?: number[] | undefined;
}

interface PdfMetadata {
  info?: Record<string, unknown> | undefined;
}

interface PdfAnnotation {
  subtype?: unknown;
  id?: unknown;
  contents?: unknown;
  color?: unknown;
  rect?: unknown;
}

interface PdfJsGlobal {
  pdfjsLib?: PdfJsLib | undefined;
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
   * Resolve the built-in PDF.js library exposed by Obsidian.
   *
   * The plugin is desktop-only (`isDesktopOnly: true`), so a DOM `window` is
   * guaranteed to exist at runtime. The `typeof window` guard is therefore
   * unnecessary here — Obsidian always exposes `pdfjsLib` on the window.
   */
  private getPdfJs(): PdfJsLib {
    const pdfjs = (window as unknown as PdfJsGlobal).pdfjsLib;
    if (!pdfjs) {
      throw new Error(
        'Obsidian PDF.js library is not available in this environment.'
      );
    }
    return pdfjs;
  }

  /**
   * Extract annotations from a PDF file in the vault.
   */
  public async extractAnnotations(file: TFile): Promise<AnnotationData[]> {
    if (file.extension !== 'pdf') {
      throw new Error('File is not a PDF');
    }

    const pdfjs = this.getPdfJs();
    const binaryData = await this.plugin.app.vault.readBinary(file);
    const loadingTask = pdfjs.getDocument({ data: binaryData });
    const pdfDoc = await loadingTask.promise;
    const annotations: AnnotationData[] = [];

    for (let pNum = 1; pNum <= pdfDoc.numPages; pNum++) {
      try {
        const page = await pdfDoc.getPage(pNum);
        const rawAnnots = await page.getAnnotations();
        if (rawAnnots.length === 0) continue;

        // Retrieve text content to map coordinates for highlights/underlines
        const textContent = await page.getTextContent();
        const textItems = textContent.items.map((item) => {
          const transform = item.transform ?? [];
          const x = transform[4] ?? 0;
          const y = transform[5] ?? 0;
          const fontSize = Math.abs(transform[3] ?? 0) || 10;
          return {
            x,
            y,
            width: item.width ?? item.str.length * fontSize * 0.6,
            height: fontSize,
            str: item.str
          };
        });

        for (const rawAnnot of rawAnnots) {
          const annot = rawAnnot as PdfAnnotation;
          const type = annot.subtype; // e.g. 'Highlight', 'Underline', 'StrikeOut', 'Text'
          if (
            typeof type !== 'string'
            || !['Highlight', 'StrikeOut', 'Text', 'Underline'].includes(type)
          ) {
            continue;
          }

          const id = typeof annot.id === 'string' && annot.id
            ? annot.id
            : `annot-${String(pNum)}-${Math.random().toString(36).slice(2, 9)}`;
          const comment = typeof annot.contents === 'string'
            ? annot.contents.trim()
            : undefined;
          const color = this.formatColor(annot.color);

          let text = '';
          if (type !== 'Text' && Array.isArray(annot.rect)) {
            // Rect is [minX, minY, maxX, maxY]
            const rect = annot.rect as number[];
            const tolerance = 2.0;

            // Find overlapping text items
            const overlapping = textItems.filter((item) => {
              const itemMinX = item.x;
              const itemMaxX = item.x + item.width;
              const itemMinY = item.y;
              const itemMaxY = item.y + item.height;

              return (
                itemMinX < (rect[2] ?? 0) + tolerance
                && itemMaxX > (rect[0] ?? 0) - tolerance
                && itemMinY < (rect[3] ?? 0) + tolerance
                && itemMaxY > (rect[1] ?? 0) - tolerance
              );
            });

            // Sort text items: vertical position descending, then horizontal ascending
            overlapping.sort((a, b) => {
              if (Math.abs(a.y - b.y) > tolerance) {
                return b.y - a.y; // top to bottom
              }
              return a.x - b.x; // left to right
            });

            text = overlapping
              .map((it) => it.str)
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim();
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
        this.plugin.debug.error(
          `Failed to parse annotations on page ${String(pNum)} of ${file.path}`,
          err
        );
      }
    }

    return annotations.sort((a, b) => a.page - b.page);
  }

  /**
   * Formats extracted annotations into a markdown block.
   */
  public formatAnnotationsMarkdown(
    annotations: AnnotationData[],
    filename: string
  ): string {
    if (annotations.length === 0) {
      return `No annotations found in **${filename}**.`;
    }

    let markdown = `### 📄 PDF Annotations: ${filename}\n\n`;
    let currentPage = -1;

    for (const annot of annotations) {
      if (annot.page !== currentPage) {
        currentPage = annot.page;
        markdown += `#### Page ${String(currentPage)}\n\n`;
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
  private formatColor(colorArray: unknown): string | undefined {
    if (!Array.isArray(colorArray) || colorArray.length < 3) {
      return undefined;
    }

    const r = Math.round(colorArray[0] as number);
    const g = Math.round(colorArray[1] as number);
    const b = Math.round(colorArray[2] as number);

    // Map common colors to readable names for better display
    if (r > 200 && g > 200 && b < 100) return 'Yellow';
    if (r < 100 && g > 200 && b < 100) return 'Green';
    if (r < 100 && g < 150 && b > 200) return 'Blue';
    if (r > 200 && g < 100 && b < 100) return 'Red';
    if (r > 200 && g < 100 && b > 200) return 'Magenta';
    if (r > 200 && g > 120 && b < 50) return 'Orange';

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
  public async extractPageText(
    file: TFile,
    pageNumber: number
  ): Promise<string> {
    if (file.extension !== 'pdf') {
      throw new Error('File is not a PDF');
    }

    const pdfjs = this.getPdfJs();
    const arrayBuffer = await this.plugin.app.vault.readBinary(file);
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) })
      .promise;

    if (pageNumber < 1 || pageNumber > pdf.numPages) {
      throw new Error(
        `Page number ${String(pageNumber)} is out of bounds (1-${String(pdf.numPages)})`
      );
    }

    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const textItems = textContent.items.map((item) => item.str);
    return textItems.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Extract document metadata from a PDF file.
   */
  public async extractMetadata(file: TFile): Promise<Record<string, string>> {
    if (file.extension !== 'pdf') {
      throw new Error('File is not a PDF');
    }

    const pdfjs = this.getPdfJs();
    const arrayBuffer = await this.plugin.app.vault.readBinary(file);
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) })
      .promise;
    const meta = await pdf.getMetadata();

    const info: Record<string, string> = {};
    if (meta.info) {
      const keys = [
        'Title',
        'Author',
        'Subject',
        'Keywords',
        'Creator',
        'Producer',
        'CreationDate',
        'ModDate'
      ];
      keys.forEach((key) => {
        const value = meta.info?.[key];
        if (
          typeof value === 'string'
          || typeof value === 'number'
          || typeof value === 'boolean'
        ) {
          info[key] = String(value);
        }
      });
    }
    return info;
  }
}
