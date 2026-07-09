import { describe, expect, it, vi } from 'vitest';
import type { Plugin } from '../Plugin.ts';
import { CanvasManager } from '../CanvasManager.ts';
import type { CanvasData } from '../CanvasManager.ts';

vi.mock('obsidian', () => ({
  Notice: class Notice { constructor(public message: string) {} },
  TFile: class TFile {}
}));

const makeMockPlugin = () =>
  ({
    app: {
      vault: {
        getFiles: vi.fn().mockReturnValue([]),
        modify: vi.fn().mockResolvedValue(undefined),
        read: vi.fn().mockResolvedValue('{"nodes":[],"edges":[]}')
      }
    },
    debug: { error: vi.fn() }
  }) as unknown as Plugin;

const makeCanvasFile = (path = 'test.canvas') => ({
  extension: 'canvas',
  path,
  basename: path.replace('.canvas', '')
} as any);

const sampleCanvas: CanvasData = {
  nodes: [
    { id: 'node1', type: 'text', x: 0, y: 0, width: 400, height: 200, text: 'Hello World' },
    { id: 'node2', type: 'file', x: 500, y: 0, width: 400, height: 300, file: 'notes/example.md' }
  ],
  edges: [
    { id: 'edge1', fromNode: 'node1', fromSide: 'right', toNode: 'node2', toSide: 'left' }
  ]
};

describe('CanvasManager', () => {
  describe('listCanvases', () => {
    it('should return only .canvas files', () => {
      const plugin = makeMockPlugin();
      (plugin.app.vault.getFiles as any).mockReturnValue([
        { extension: 'canvas', path: 'a.canvas' },
        { extension: 'md', path: 'b.md' },
        { extension: 'canvas', path: 'c.canvas' }
      ]);
      const manager = new CanvasManager(plugin);
      expect(manager.listCanvases()).toHaveLength(2);
    });

    it('should return empty array when no canvas files exist', () => {
      const plugin = makeMockPlugin();
      (plugin.app.vault.getFiles as any).mockReturnValue([
        { extension: 'md', path: 'note.md' }
      ]);
      const manager = new CanvasManager(plugin);
      expect(manager.listCanvases()).toHaveLength(0);
    });
  });

  describe('parseCanvas', () => {
    it('should return null for non-canvas files', async () => {
      const plugin = makeMockPlugin();
      const manager = new CanvasManager(plugin);
      const result = await manager.parseCanvas({ extension: 'md', path: 'test.md' } as any);
      expect(result).toBeNull();
    });

    it('should parse valid canvas JSON', async () => {
      const plugin = makeMockPlugin();
      (plugin.app.vault.read as any).mockResolvedValue(JSON.stringify(sampleCanvas));
      const manager = new CanvasManager(plugin);
      const result = await manager.parseCanvas(makeCanvasFile());
      expect(result).not.toBeNull();
      expect(result!.nodes).toHaveLength(2);
      expect(result!.edges).toHaveLength(1);
    });

    it('should return null on invalid JSON', async () => {
      const plugin = makeMockPlugin();
      (plugin.app.vault.read as any).mockResolvedValue('not valid json {{{');
      const manager = new CanvasManager(plugin);
      const result = await manager.parseCanvas(makeCanvasFile());
      expect(result).toBeNull();
      expect(plugin.debug.error).toHaveBeenCalled();
    });
  });

  describe('formatCanvasForContext', () => {
    it('should include node count and edge count', () => {
      const plugin = makeMockPlugin();
      const manager = new CanvasManager(plugin);
      const file = makeCanvasFile('mind-map.canvas');
      const result = manager.formatCanvasForContext(sampleCanvas, file);
      expect(result).toContain('Canvas: mind-map');
      expect(result).toContain('Nodes: 2');
      expect(result).toContain('Edges: 1');
    });

    it('should list all node types', () => {
      const plugin = makeMockPlugin();
      const manager = new CanvasManager(plugin);
      const result = manager.formatCanvasForContext(sampleCanvas, makeCanvasFile());
      expect(result).toContain('[text]');
      expect(result).toContain('[file]');
    });

    it('should include instructions for modification', () => {
      const plugin = makeMockPlugin();
      const manager = new CanvasManager(plugin);
      const result = manager.formatCanvasForContext({ nodes: [], edges: [] }, makeCanvasFile());
      expect(result).toContain('Nodes require:');
    });
  });

  describe('generateCanvas', () => {
    it('should produce valid JSON', () => {
      const plugin = makeMockPlugin();
      const manager = new CanvasManager(plugin);
      const json = manager.generateCanvas(sampleCanvas.nodes, sampleCanvas.edges);
      const parsed = JSON.parse(json) as CanvasData;
      expect(parsed.nodes).toHaveLength(2);
      expect(parsed.edges).toHaveLength(1);
    });
  });

  describe('addNodeToCanvas', () => {
    it('should add a node and write the updated canvas', async () => {
      const plugin = makeMockPlugin();
      (plugin.app.vault.read as any).mockResolvedValue(JSON.stringify({ nodes: [], edges: [] }));
      const manager = new CanvasManager(plugin);
      const node = await manager.addNodeToCanvas(makeCanvasFile(), {
        height: 200,
        text: 'New node',
        type: 'text',
        width: 400
      });
      expect(node).not.toBeNull();
      expect(node!.type).toBe('text');
      expect(node!.text).toBe('New node');
      expect(node!.id).toHaveLength(16);
      expect(plugin.app.vault.modify).toHaveBeenCalled();
    });

    it('should auto-position node below existing nodes', async () => {
      const plugin = makeMockPlugin();
      (plugin.app.vault.read as any).mockResolvedValue(
        JSON.stringify({ nodes: [{ id: 'n1', type: 'text', x: 0, y: 0, width: 400, height: 200, text: 'existing' }], edges: [] })
      );
      const manager = new CanvasManager(plugin);
      const node = await manager.addNodeToCanvas(makeCanvasFile(), {
        height: 200, text: 'New', type: 'text', width: 400
      });
      // Should be positioned below the existing node (y: 0 + 200 + 40 = 240)
      expect(node!.y).toBe(240);
    });
  });
});
