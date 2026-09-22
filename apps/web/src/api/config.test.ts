import { resolveApiUrl } from './config';

describe('production API location', () => {
  it('defaults to the same-origin proxy and retains local development', () => {
    expect(resolveApiUrl(undefined, true)).toBe('/api');
    expect(resolveApiUrl(undefined, false)).toBe('http://localhost:3000');
    expect(resolveApiUrl('https://api.example.com/', true)).toBe('https://api.example.com');
  });
  it.each([
    'http://api.example.com',
    '//evil.example.com',
    'https://user:secret@example.com',
    'https://example.com/path',
    'https://example.com?secret=1',
  ])('rejects unsafe production configuration %s', (value) => {
    expect(() => resolveApiUrl(value, true)).toThrow();
  });
});
