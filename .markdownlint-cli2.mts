// Simple markdownlint configuration
export const config = {
  files: {
    include: ['**/*.md'],
    exclude: ['node_modules', 'dist', '.git']
  },
  config: {
    'line-length': false,
    'no-trailing-spaces': true
  }
};
