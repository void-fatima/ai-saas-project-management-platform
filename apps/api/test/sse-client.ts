import { get } from 'node:http';

export function sseClient(url: string, cookie: string) {
  const frames: string[] = [];
  const listeners = new Set<() => void>();
  const req = get(url, { headers: { Cookie: cookie } });
  let error: Error | undefined;
  req.on('error', (failure) => {
    error = failure;
    for (const listener of listeners) listener();
  });
  req.on('response', (res) => {
    if (res.statusCode !== 200) {
      error = new Error(`SSE status ${res.statusCode}`);
      for (const listener of listeners) listener();
      res.resume();
      return;
    }
    res.setEncoding('utf8');
    let buffer = '';
    res.on('data', (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        frames.push(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
      for (const listener of listeners) listener();
    });
  });
  return {
    frames,
    close: () => req.destroy(),
    wait(event: string, after = 0) {
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Missing SSE ${event}`));
        }, 5000);
        function cleanup() {
          clearTimeout(timer);
          listeners.delete(check);
        }
        function check() {
          const frame = frames.slice(after).find((f) => f.startsWith(`event: ${event}\n`));
          if (error) {
            cleanup();
            reject(error);
          } else if (frame) {
            cleanup();
            resolve(frame);
          }
        }
        listeners.add(check);
        check();
      });
    },
  };
}
