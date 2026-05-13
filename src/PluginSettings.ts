export class PluginSettings {
  /* eslint-disable no-magic-numbers -- In plugin settings magic numbers are allowed. */
  // Hermes Agent API Configuration
  public hermesApiUrl = 'http://127.0.0.1:8642';
  public hermesApiKey = '';
  public hermesAgentName = 'hermes-agent';
  
  // Context Selection
  public contextMode: 'editor' | 'selection' = 'editor';
  public contextAutoSelect = true;

  /* eslint-enable no-magic-numbers -- In plugin settings magic numbers are allowed. */
}
