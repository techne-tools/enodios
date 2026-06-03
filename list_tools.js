const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { spawn } = require('child_process');

async function main() {
  const hermesCmd = 'hermes'; // assuming it's in PATH, or I'll use npx hermes
  
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['hermes', 'acp']
  });

  const client = new Client({
    name: 'test-client',
    version: '1.0.0'
  }, {
    capabilities: {}
  });

  await client.connect(transport);
  
  const tools = await client.listTools();
  console.log(JSON.stringify(tools, null, 2));
  
  process.exit(0);
}
main().catch(console.error);
