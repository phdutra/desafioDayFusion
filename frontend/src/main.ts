// Polyfill para process.env (necessário para widget AWS Face Liveness)
declare const process: { env: { NODE_ENV: string } } | undefined;

if (typeof process === 'undefined' || !process) {
  const processPolyfill = {
    env: {
      NODE_ENV: 'production'
    }
  };
  // Definir tanto no window quanto globalmente
  (window as any).process = processPolyfill;
  (globalThis as any).process = processPolyfill;
}

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { Amplify } from 'aws-amplify';
import awsExports from './aws-exports';
import { ReadableStream as PolyfillReadableStream } from 'web-streams-polyfill';

const currentReadableStream = (globalThis as any).ReadableStream;
if (!currentReadableStream || typeof currentReadableStream.prototype?.getReader !== 'function') {
  (globalThis as any).ReadableStream = PolyfillReadableStream;
}

window.addEventListener('error', () => {});
window.addEventListener('unhandledrejection', () => {});

const originalFetch = globalThis.fetch?.bind(globalThis);
if (originalFetch) {
  globalThis.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (!response.ok) {
      try {
        const clone = response.clone();
        const contentType = clone.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          await clone.json();
        } else {
          await clone.text();
        }
      } catch {
      }
    }
    const body: any = (response as any).body;
    if (body && typeof body.getReader !== 'function') {
      // Body não tem getReader - silencioso
    }
    return response;
  };
}

// Configurar Amplify globalmente (necessário para FaceLivenessDetector)
try {
  Amplify.configure(awsExports);
  // Exportar Amplify para window para widgets standalone acessarem
  (window as any).Amplify = Amplify;
  // Também exportar como globalThis para garantir acesso
  (globalThis as any).Amplify = Amplify;
  console.log('[Main] Amplify configurado e exportado para window e globalThis');
} catch (error) {
  console.error('[Main] Erro ao configurar Amplify:', error);
}

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => {
    // Mostrar erro na tela se possível
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; background: #f44336; color: white; padding: 20px; z-index: 9999; font-family: monospace;';
    errorDiv.innerHTML = `
      <h2>❌ Erro ao inicializar aplicação</h2>
      <p><strong>Erro:</strong> ${err?.message || err}</p>
      <p><strong>Verifique o console (F12) para mais detalhes</strong></p>
      <pre>${err?.stack || 'Sem stack trace disponível'}</pre>
    `;
    document.body.appendChild(errorDiv);
  });
