export function resolveApiUrl(value: string | undefined, production: boolean): string {
  const selected = value ?? (production ? '/api' : 'http://localhost:3000');
  if (selected === '/api') return selected;
  const url = new URL(selected);
  if (
    url.origin !== selected.replace(/\/+$/, '') ||
    url.username ||
    url.password ||
    !['https:', ...(production ? [] : ['http:'])].includes(url.protocol)
  )
    throw new Error('API URL must be /api or a secure origin.');
  return url.origin;
}

export const apiUrl = resolveApiUrl(import.meta.env.VITE_API_URL, import.meta.env.PROD);
