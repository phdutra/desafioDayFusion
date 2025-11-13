import { CommonModule } from '@angular/common';
import { Component, signal, OnInit, HostListener } from '@angular/core';

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
  readonly sections = signal<HelpSection[]>([
    { id: 'anti-deepfake', title: 'Segurança Anti-Deepfake', icon: '🛡️', active: true },
    { id: 'fluxo', title: 'Fluxo de Autenticação', icon: '🔄', active: false },
    { id: 'face-liveness', title: 'Face Liveness 3D', icon: '🧠', active: false },
    { id: 'match', title: 'Comparação Facial', icon: '🎯', active: false },
    { id: 'compressao', title: 'Compressão Automática', icon: '📦', active: false },
    { id: 'como-usar', title: 'Como Usar Anti-Deepfake', icon: '🎬', active: false },
    { id: 'api', title: 'Arquitetura & APIs', icon: '⚙️', active: false },
    { id: 'seguranca', title: 'Políticas de Segurança', icon: '🔒', active: false }
  ]);

  readonly currentSection = signal<string>('anti-deepfake');
  readonly sidebarOpen = signal<boolean>(false);
  private readonly scrollOffset = 180;
  private userScrolling = false;

  toggleSidebar(): void {
    this.sidebarOpen.update((value) => !value);
  }

  closeSidebar(): void {
    if (this.sidebarOpen()) {
      this.sidebarOpen.set(false);
    }
  }

  ngOnInit(): void {
    setTimeout(() => this.detectSectionInView(), 0);
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (this.userScrolling) {
      return;
    }
    this.detectSectionInView();
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
    this.closeSidebar();
    
    this.updateActiveSection(sectionId);
    
    // Scroll suave até a seção
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Libera detecção automática após 1 segundo
    setTimeout(() => {
      this.userScrolling = false;
      this.detectSectionInView();
    }, 1000);
  }

  /**
   * Detecta qual seção está visível com base na posição do scroll
   */
  private detectSectionInView(): void {
    const sections = this.sections();
    if (sections.length === 0) {
      return;
    }

    let activeId = sections[0].id;

    for (const section of sections) {
      const element = document.getElementById(section.id);
      if (!element) {
        continue;
      }

      const rect = element.getBoundingClientRect();

      if (rect.top <= this.scrollOffset) {
        activeId = section.id;
      }
    }

    if (activeId && activeId !== this.currentSection()) {
      this.updateActiveSection(activeId);
    }
  }
}

