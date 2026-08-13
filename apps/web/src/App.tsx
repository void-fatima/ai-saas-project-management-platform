import { useEffect, useState } from 'react';

type ApiStatus = 'checking' | 'available' | 'unavailable';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    const controller = new AbortController();

    async function checkApi(): Promise<void> {
      try {
        const response = await fetch(`${apiUrl}/health`, { signal: controller.signal });
        setApiStatus(response.ok ? 'available' : 'unavailable');
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setApiStatus('unavailable');
      }
    }

    void checkApi();
    return () => controller.abort();
  }, []);

  return (
    <main className="app-shell">
      <section className="status-card" aria-labelledby="product-name">
        <p className="eyebrow">Foundation · Phase 1</p>
        <h1 id="product-name">Project Platform</h1>
        <p className="summary">
          A production-minded foundation for collaborative, AI-assisted project management.
        </p>
        <div className="status-row" role="status" aria-live="polite">
          <span className={`status-dot status-dot--${apiStatus}`} aria-hidden="true" />
          <span>API {apiStatus}</span>
        </div>
      </section>
    </main>
  );
}
