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

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
