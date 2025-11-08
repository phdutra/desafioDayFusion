// Polyfill para process.env (necessário para widget AWS Face Liveness)
declare const process: { env: { NODE_ENV: string } } | undefined;

if (typeof process === 'undefined' || !process) {
  const processPolyfill = {
    env: {
      NODE_ENV: 'development'
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
  console.warn('[ReadableStream] Implementação nativa ausente ou incompleta. Aplicando polyfill.');
  (globalThis as any).ReadableStream = PolyfillReadableStream;
} else {
  console.info('[ReadableStream] Implementação nativa detectada.', {
    name: currentReadableStream.name,
    hasGetReader: typeof currentReadableStream.prototype?.getReader === 'function'
  });
}

const finalReadableStream = (globalThis as any).ReadableStream;
console.info('[ReadableStream] Implementação ativa após verificação.', {
  name: finalReadableStream?.name,
  hasGetReader: typeof finalReadableStream?.prototype?.getReader === 'function'
});

window.addEventListener('error', (event) => {
  console.error('[global-error]', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error
  });
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[global-unhandledrejection]', event.reason);
});

const originalFetch = globalThis.fetch?.bind(globalThis);
if (originalFetch) {
  globalThis.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (!response.ok) {
      try {
        const clone = response.clone();
        const contentType = clone.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const json = await clone.json();
          console.error('[fetch][error-json]', args[0], response.status, json);
        } else {
          const text = await clone.text();
          console.error('[fetch][error-text]', args[0], response.status, text);
        }
      } catch (logError) {
        console.error('[fetch][error-log-failed]', args[0], response.status, logError);
      }
    }
    const body: any = (response as any).body;
    if (body && typeof body.getReader !== 'function') {
      console.warn('[fetch][body-without-getReader]', {
        resource: args[0],
        constructorName: body?.constructor?.name,
        keys: typeof body === 'object' ? Object.keys(body ?? {}) : undefined
      });
    }
    return response;
  };
}

// Configurar Amplify globalmente (necessário para FaceLivenessDetector)
try {
  Amplify.configure(awsExports);
  console.log('✅ Amplify configurado globalmente:', {
    region: awsExports.aws_project_region,
    identityPoolId: awsExports.aws_cognito_identity_pool_id ? '***' : 'NÃO CONFIGURADO'
  });
} catch (error: any) {
  console.error('❌ Erro ao configurar Amplify:', error);
}

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => {
    console.error('❌ ERRO CRÍTICO ao inicializar aplicação Angular:', err);
    console.error('Stack trace:', err?.stack);
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
