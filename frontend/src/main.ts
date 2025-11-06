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
