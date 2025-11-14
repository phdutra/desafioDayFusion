import { CommonModule } from '@angular/common';
import { Component, signal, OnInit, HostListener, inject } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';

interface HelpSection {
  id: string;
  title: string;
  icon: string;
  active: boolean;
}

@Component({
  selector: 'app-help',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './help.component.html',
  styleUrls: ['./help.component.scss']
})
export class HelpComponent implements OnInit {
  private readonly authService = inject(AuthService);
  
  readonly sections = signal<HelpSection[]>([
    { id: 'anti-deepfake', title: 'Segurança Anti-Deepfake', icon: '🛡️', active: true },
    { id: 'fluxo', title: 'Fluxo de Autenticação', icon: '🔄', active: false },
    { id: 'face-liveness', title: 'Face Liveness 3D', icon: '🧠', active: false },
    { id: 'match', title: 'Comparação Facial', icon: '🎯', active: false },
    { id: 'validacao-documento', title: 'Validação de Documento', icon: '📄', active: false },
    { id: 'compressao', title: 'Compressão Automática', icon: '📦', active: false },
    { id: 'como-usar', title: 'Como Usar Anti-Deepfake', icon: '🎬', active: false },
    { id: 'api', title: 'Arquitetura & APIs', icon: '⚙️', active: false },
    { id: 'seguranca', title: 'Políticas de Segurança', icon: '🔒', active: false }
  ]);

  readonly currentSection = signal<string>('anti-deepfake');
  readonly sidebarOpen = signal<boolean>(false);
  readonly isAuthenticated = signal<boolean>(false);
  private readonly scrollOffset = 180;
  private userScrolling = false;
  private scrollTimeout: number | null = null;

  toggleSidebar(): void {
    this.sidebarOpen.update((value) => !value);
  }

  closeSidebar(): void {
    if (this.sidebarOpen()) {
      this.sidebarOpen.set(false);
    }
  }

  ngOnInit(): void {
    // Verifica se o usuário está autenticado (apenas para informação, não para autorização)
    // Todas as seções são públicas e acessíveis sem autenticação
    // A rota /help não requer autenticação e não aplica restrições baseadas em autenticação
    this.isAuthenticated.set(this.authService.isAuthenticated());
    
    // Observa mudanças no estado de autenticação (opcional, apenas para informação)
    // Usa effect ou subscription para sincronizar com o signal do AuthService
    this.authService.currentUser$.subscribe(() => {
      this.isAuthenticated.set(this.authService.isAuthenticated());
    });
    
    setTimeout(() => this.detectSectionInView(), 100);
  }

  @HostListener('window:scroll', ['$event'])
  onWindowScroll(): void {
    if (this.userScrolling) {
      return;
    }

    // Throttle para melhor performance
    if (this.scrollTimeout !== null) {
      window.cancelAnimationFrame(this.scrollTimeout);
    }

    this.scrollTimeout = window.requestAnimationFrame(() => {
      this.detectSectionInView();
      this.scrollTimeout = null;
    });
  }

  /**
   * Atualiza a seção ativa no menu
   */
  private updateActiveSection(sectionId: string): void {
    if (sectionId === this.currentSection()) {
      return; // Já está ativa, não precisa atualizar
    }

    this.sections.update(sections =>
      sections.map(section => ({
        ...section,
        active: section.id === sectionId
      }))
    );
    this.currentSection.set(sectionId);
  }

  /**
   * Clique manual no menu - scroll para seção
   */
  selectSection(sectionId: string): void {
    this.userScrolling = true;
    this.closeSidebar();
    
    this.updateActiveSection(sectionId);
    
    // Scroll suave até a seção
    const element = document.getElementById(sectionId);
    if (element) {
      const offsetPosition = element.getBoundingClientRect().top + window.pageYOffset - this.scrollOffset;
      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    }

    // Libera detecção automática após scroll terminar
    setTimeout(() => {
      this.userScrolling = false;
      this.detectSectionInView();
    }, 1500);
  }

  /**
   * Detecta qual seção está visível com base na posição do scroll
   */
  private detectSectionInView(): void {
    const sections = this.sections();
    if (sections.length === 0) {
      return;
    }

    let activeId: string | null = null;
    let bestDistance = Infinity;

    // Procura a seção que está mais próxima do topo de referência (offset)
    // rect.top já está em coordenadas do viewport
    for (const section of sections) {
      const element = document.getElementById(section.id);
      if (!element) {
        continue;
      }

      const rect = element.getBoundingClientRect();

      // Verifica se a seção está no range do offset (topo da área de conteúdo)
      // Considera se a seção passou pelo topo ou está próxima dele
      const isPastTop = rect.top <= this.scrollOffset;
      const isBeforeTop = rect.top > this.scrollOffset && rect.top < this.scrollOffset + 200;
      
      if (isPastTop || isBeforeTop) {
        // Calcula a distância do topo da seção até o ponto de referência
        const distance = Math.abs(rect.top - this.scrollOffset);
        
        if (distance < bestDistance) {
          activeId = section.id;
          bestDistance = distance;
        }
      }
    }

    // Se não encontrou nenhuma no range, procura a última que passou o offset
    if (!activeId) {
      for (let i = sections.length - 1; i >= 0; i--) {
        const element = document.getElementById(sections[i].id);
        if (element) {
          const rect = element.getBoundingClientRect();
          
          // Seção já passou pelo topo de referência
          if (rect.top <= this.scrollOffset) {
            activeId = sections[i].id;
            break;
          }
        }
      }
    }

    // Fallback para primeira seção se ainda não encontrou ou se está no topo da página
    const scrollPosition = window.pageYOffset || document.documentElement.scrollTop;
    if (!activeId || scrollPosition < 100) {
      activeId = sections[0].id;
    }

    if (activeId && activeId !== this.currentSection()) {
      this.updateActiveSection(activeId);
    }
  }
}

