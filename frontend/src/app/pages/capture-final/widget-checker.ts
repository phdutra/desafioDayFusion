/**
 * Helper para verificar disponibilidade dos widgets AWS
 */

export interface WidgetCheckResult {
  available: boolean;
  widgetType: 'AwsLiveness' | 'FaceLiveness' | null;
  attempts: number;
}

/**
 * Verifica se widget está disponível em diferentes escopos
 */
function checkWidgetAvailable(): { available: boolean; widgetType: 'AwsLiveness' | 'FaceLiveness' | null } {
  // Verificar em window (global)
  const win = window as any;
  
  // Verificar AwsLiveness em diferentes formas
  if (typeof win.AwsLiveness !== 'undefined' && win.AwsLiveness !== null) {
    return { available: true, widgetType: 'AwsLiveness' };
  }
  
  // Verificar FaceLiveness em diferentes formas
  if (typeof win.FaceLiveness !== 'undefined' && win.FaceLiveness !== null) {
    return { available: true, widgetType: 'FaceLiveness' };
  }
  
  // Verificar em globalThis
  const global = globalThis as any;
  if (typeof global.AwsLiveness !== 'undefined' && global.AwsLiveness !== null) {
    return { available: true, widgetType: 'AwsLiveness' };
  }
  
  if (typeof global.FaceLiveness !== 'undefined' && global.FaceLiveness !== null) {
    return { available: true, widgetType: 'FaceLiveness' };
  }
  
  // Verificar se scripts carregaram
  const scripts = Array.from(document.scripts);
  const hasLivenessScript = scripts.some(s => 
    s.src.includes('faceLiveness') || 
    s.src.includes('face-liveness') ||
    s.src.includes('liveness/widget')
  );
  
  if (!hasLivenessScript) {
    console.warn('[Widget Checker] Scripts de liveness não encontrados no DOM');
  }
  
  return { available: false, widgetType: null };
}

/**
 * Aguarda e verifica se algum widget AWS está disponível
 */
export async function waitForWidget(maxAttempts = 50, interval = 200): Promise<WidgetCheckResult> {
  let attempts = 0;
  
  console.log('[Widget Checker] Iniciando verificação de widgets AWS...');
  
  // Verificar se scripts estão no DOM
  const scripts = Array.from(document.scripts);
  const livenessScripts = scripts.filter(s => 
    s.src.includes('faceLiveness') || 
    s.src.includes('face-liveness') ||
    s.src.includes('liveness/widget')
  );
  
  console.log('[Widget Checker] Scripts de liveness encontrados:', livenessScripts.length);
  livenessScripts.forEach(s => console.log('  -', s.src));
  
  // Verificar estado inicial
  const win = window as any;
  console.log('[Widget Checker] Estado inicial:');
  console.log('  - window.AwsLiveness:', typeof win.AwsLiveness, win.AwsLiveness ? '✓' : '✗');
  console.log('  - window.FaceLiveness:', typeof win.FaceLiveness, win.FaceLiveness ? '✓' : '✗');
  
  // Se não estiver disponível e scripts podem ter falhado, tentar carregar dinamicamente
  const initialCheck = checkWidgetAvailable();
  if (!initialCheck.available && attempts === 0) {
    console.log('[Widget Checker] Widgets não disponíveis, tentando carregar scripts dinamicamente...');
    await loadAwsWidgets();
  }
  
  while (attempts < maxAttempts) {
    const check = checkWidgetAvailable();
    
    if (check.available) {
      console.log(`[Widget Checker] ✅ ${check.widgetType} encontrado após ${attempts} tentativas`);
      return {
        available: true,
        widgetType: check.widgetType!,
        attempts
      };
    }
    
    // Log a cada 5 tentativas
    if (attempts % 5 === 0 && attempts > 0) {
      console.log(`[Widget Checker] Aguardando... tentativa ${attempts}/${maxAttempts}`);
      console.log(`  - window.AwsLiveness: ${typeof win.AwsLiveness}`);
      console.log(`  - window.FaceLiveness: ${typeof win.FaceLiveness}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, interval));
    attempts++;
  }
  
  console.error(`[Widget Checker] ❌ Nenhum widget encontrado após ${attempts} tentativas`);
  console.error('[Widget Checker] Scripts carregados:', 
    Array.from(document.scripts)
      .map(s => s.src)
      .filter(s => s.includes('liveness') || s.includes('face') || s.includes('aws'))
  );
  
  // Listar todas as propriedades do window que podem ser relevantes
  const windowKeys = Object.keys(window).filter(k => 
    k.toLowerCase().includes('liveness') || 
    k.toLowerCase().includes('face') ||
    k.toLowerCase().includes('aws')
  );
  console.error('[Widget Checker] Propriedades relevantes em window:', windowKeys);
  
  // Verificar se scripts falharam ao carregar
  const failedScripts = livenessScripts.filter(s => {
    const script = document.querySelector(`script[src="${s.src}"]`);
    return script && script.hasAttribute('onerror');
  });
  if (failedScripts.length > 0) {
    console.error('[Widget Checker] ⚠️ Alguns scripts podem ter falhado ao carregar:', failedScripts.map(s => s.src));
    console.error('[Widget Checker] Tentando carregar scripts dinamicamente como último recurso...');
    await loadAwsWidgets();
    // Verificar novamente após tentar carregar
    const finalCheck = checkWidgetAvailable();
    if (finalCheck.available) {
      console.log(`[Widget Checker] ✅ ${finalCheck.widgetType} encontrado após carregamento dinâmico!`);
      return {
        available: true,
        widgetType: finalCheck.widgetType!,
        attempts: maxAttempts + 1
      };
    }
  }
  
  return {
    available: false,
    widgetType: null,
    attempts
  };
}

/**
 * Verifica imediatamente se os widgets estão disponíveis
 */
export function checkWidgets(): WidgetCheckResult {
  const check = checkWidgetAvailable();
  return { ...check, attempts: 0 };
}

/**
 * Carrega script dinamicamente
 */
async function loadScript(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Verificar se já existe
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve(true);
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      console.log(`[Widget Checker] ✅ Script carregado: ${src}`);
      resolve(true);
    };
    script.onerror = () => {
      console.error(`[Widget Checker] ❌ Erro ao carregar script: ${src}`);
      resolve(false);
    };
    document.head.appendChild(script);
  });
}

/**
 * Tenta carregar scripts AWS dinamicamente
 */
export async function loadAwsWidgets(): Promise<boolean> {
  console.log('[Widget Checker] Tentando carregar scripts AWS dinamicamente...');
  
  const scripts = [
    'https://assets.face-liveness.aws.dev/v2/face-liveness.js',
    'https://d2vvq1ykw7p3zk.cloudfront.net/faceLiveness/latest/faceLiveness.js'
  ];

  const results = await Promise.all(scripts.map(src => loadScript(src)));
  
  // Aguardar scripts processarem
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  return results.some(r => r);
}

/**
 * Obtém a classe do widget disponível
 */
export function getWidgetClass(): any {
  const win = window as any;
  
  if (typeof win.AwsLiveness !== 'undefined' && win.AwsLiveness !== null) {
    return win.AwsLiveness;
  }
  
  if (typeof win.FaceLiveness !== 'undefined' && win.FaceLiveness !== null) {
    const WidgetClass = win.FaceLiveness.default || win.FaceLiveness;
    return WidgetClass;
  }
  
  if (typeof (globalThis as any).AwsLiveness !== 'undefined') {
    return (globalThis as any).AwsLiveness;
  }
  
  if (typeof (globalThis as any).FaceLiveness !== 'undefined') {
    const WidgetClass = (globalThis as any).FaceLiveness.default || (globalThis as any).FaceLiveness;
    return WidgetClass;
  }
  
  return null;
}

