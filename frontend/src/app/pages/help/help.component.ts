import { CommonModule } from '@angular/common';
import { Component, signal, OnInit, OnDestroy, HostListener } from '@angular/core';

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
export class HelpComponent implements OnInit, OnDestroy {
  readonly sections = signal<HelpSection[]>([
    { id: 'anti-deepfake', title: 'Segurança Anti-Deepfake', icon: '🛡️', active: true },
    { id: 'fluxo', title: 'Fluxo de Autenticação', icon: '🔄', active: false },
    { id: 'face-liveness', title: 'Face Liveness 3D', icon: '🧠', active: false },
    { id: 'match', title: 'Comparação Facial', icon: '🎯', active: false },
    { id: 'como-usar', title: 'Como Usar Anti-Deepfake', icon: '🎬', active: false },
    { id: 'api', title: 'Arquitetura & APIs', icon: '⚙️', active: false },
    { id: 'seguranca', title: 'Políticas de Segurança', icon: '🔒', active: false }
  ]);

  readonly currentSection = signal<string>('anti-deepfake');
  
  private intersectionObserver?: IntersectionObserver;
  private userScrolling = false;

  ngOnInit(): void {
    this.setupScrollSpy();
  }

  ngOnDestroy(): void {
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }
  }

  /**
   * Configura o IntersectionObserver para detectar seções visíveis
   */
  private setupScrollSpy(): void {
    const options = {
      root: null,
      rootMargin: '-20% 0px -60% 0px', // Ativa quando seção está no topo/meio da tela
      threshold: [0, 0.1, 0.2, 0.3]
    };

    this.intersectionObserver = new IntersectionObserver((entries) => {
      // Somente atualiza se não for scroll manual do usuário
      if (this.userScrolling) return;

      // Encontra a seção mais visível
      const visibleEntries = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

      if (visibleEntries.length > 0) {
        const mostVisible = visibleEntries[0];
        const sectionId = mostVisible.target.id;
        
        if (sectionId && this.currentSection() !== sectionId) {
          this.updateActiveSection(sectionId);
        }
      }
    }, options);

    // Observa todas as seções
    setTimeout(() => {
      this.sections().forEach(section => {
        const element = document.getElementById(section.id);
        if (element) {
          this.intersectionObserver?.observe(element);
        }
      });
    }, 100);
  }

  /**
   * Atualiza a seção ativa no menu
   */
  private updateActiveSection(sectionId: string): void {
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
    
    this.updateActiveSection(sectionId);
    
    // Scroll suave até a seção
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Libera detecção automática após 1 segundo
    setTimeout(() => {
      this.userScrolling = false;
    }, 1000);
  }
}

