import {
  Notice,
  TFile
} from 'obsidian';

import type { Plugin } from './Plugin.ts';

/**
 * Describes a node in a Canvas JSON file.
 * Only the fields relevant to Hermes context are typed; the spec allows extras.
 */
export interface CanvasNode {
  id: string;
  type: 'file' | 'group' | 'link' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  /** For text nodes */
  text?: string;
  /** For file nodes */
  file?: string;
  /** For link nodes */
  url?: string;
  /** For group nodes */
  label?: string;
  color?: string;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide: 'bottom' | 'left' | 'right' | 'top';
  toNode: string;
  toSide: 'bottom' | 'left' | 'right' | 'top';
  label?: string;
  color?: string;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/**
 * Manages Canvas files (.canvas) in the vault.
 *
 * ARCHITECTURAL ROLE:
 * CanvasManager replaces the raw JSON dump in the existing `/canvas` slash command
 * with a structured, typed representation. It can parse, summarise, generate, and
 * mutate canvas files, enabling the Hermes agent to work with visual mind-maps in
 * a semantically meaningful way.
 *
 * DESIGN DECISIONS:
 * - All mutations are written atomically via `vault.modify()` to avoid partial writes.
 * - Node IDs are generated as 16-character hex strings matching Obsidian's own format.
 * - `generateCanvas()` is a pure function (no file I/O) so it can be used in tests.
 */
export class CanvasManager {
  private readonly plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Returns all `.canvas` files in the vault.
   */
  public listCanvases(): TFile[] {
    return this.plugin.app.vault
      .getFiles()
      .filter((f) => f.extension === 'canvas');
  }

  /**
   * Reads and parses a `.canvas` JSON file. Returns null on parse error.
   */
  public async parseCanvas(file: TFile): Promise<CanvasData | null> {
    if (file.extension !== 'canvas') {
      return null;
    }
    try {
      const raw = await this.plugin.app.vault.read(file);
      return JSON.parse(raw) as CanvasData;
    } catch (err) {
      this.plugin.debug.error(`Failed to parse canvas: ${file.path}`, err);
      return null;
    }
  }

  /**
   * Generates valid Canvas JSON from a spec object.
   * This is a pure transformation — no file is created.
   */
  public generateCanvas(nodes: CanvasNode[], edges: CanvasEdge[]): string {
    const data: CanvasData = { edges, nodes };
    return JSON.stringify(data, null, 2);
  }

  /**
   * Formats a parsed CanvasData as a human-readable markdown context block.
   */
  public formatCanvasForContext(canvas: CanvasData, file: TFile): string {
    const nodeCount = canvas.nodes.length;
    const edgeCount = canvas.edges.length;

    const typeCounts: Record<string, number> = {};
    for (const node of canvas.nodes) {
      typeCounts[node.type] = (typeCounts[node.type] ?? 0) + 1;
    }
    const typeSummary = Object.entries(typeCounts)
      .map(([t, c]) => `${String(c)} ${t}`)
      .join(', ');

    const lines: string[] = [
      `--- Canvas: ${file.basename} ---`,
      `Nodes: ${String(nodeCount)} (${typeSummary || 'none'})`,
      `Edges: ${String(edgeCount)}`,
      ''
    ];

    if (canvas.nodes.length > 0) {
      lines.push('Nodes:');
      for (const node of canvas.nodes) {
        const label = node.text?.slice(0, 80)
          ?? node.label
          ?? node.file
          ?? node.url
          ?? '(unlabeled)';
        lines.push(`  [${node.type}] id=${node.id} — ${label}`);
      }
      lines.push('');
    }

    if (canvas.edges.length > 0) {
      lines.push('Edges:');
      for (const edge of canvas.edges) {
        const label = edge.label ? ` "${edge.label}"` : '';
        lines.push(
          `  ${edge.fromNode}(${edge.fromSide}) →${label} ${edge.toNode}(${edge.toSide})`
        );
      }
      lines.push('');
    }

    lines.push(
      'To modify this canvas, write valid JSON to the .canvas file path.',
      'Nodes require: id, type, x, y, width, height.',
      'Edges require: id, fromNode, fromSide, toNode, toSide.',
      '------------------------------'
    );

    return lines.join('\n');
  }

  /**
   * Appends a new node to an existing canvas file.
   * Auto-positions the node below all existing nodes if no x/y are provided.
   */
  public async addNodeToCanvas(
    file: TFile,
    node: Omit<CanvasNode, 'id' | 'x' | 'y'> & { x?: number; y?: number }
  ): Promise<CanvasNode | null> {
    const canvas = await this.parseCanvas(file);
    if (!canvas) {
      new Notice(`Cannot add node: failed to parse ${file.basename}`);
      return null;
    }

    const maxY = canvas.nodes.reduce(
      (acc, n) => Math.max(acc, n.y + n.height),
      0
    );
    const newNode: CanvasNode = {
      height: node.height,
      id: this.generateNodeId(),
      type: node.type,
      width: node.width,
      x: node.x ?? 0,
      y: node.y ?? maxY + 40,
      ...(node.text !== undefined && { text: node.text }),
      ...(node.file !== undefined && { file: node.file }),
      ...(node.url !== undefined && { url: node.url }),
      ...(node.label !== undefined && { label: node.label }),
      ...(node.color !== undefined && { color: node.color })
    };

    canvas.nodes.push(newNode);
    await this.plugin.app.vault.modify(
      file,
      JSON.stringify({ edges: canvas.edges, nodes: canvas.nodes }, null, 2)
    );
    return newNode;
  }

  /** Generates a 16-character hex node ID matching Obsidian's own format. */
  private generateNodeId(): string {
    return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }
}
