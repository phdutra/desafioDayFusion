import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';

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
export class HelpComponent {
  readonly sections = signal<HelpSection[]>([
    { id: 'anti-deepfake', title: 'Segurança Anti-Deepfake', icon: '🛡️', active: true },
    { id: 'fluxo', title: 'Fluxo de Autenticação', icon: '🔄', active: false },
    { id: 'face-liveness', title: 'Face Liveness 3D', icon: '🧠', active: false },
    { id: 'match', title: 'Comparação Facial', icon: '🎯', active: false },
    { id: 'api', title: 'Arquitetura & APIs', icon: '⚙️', active: false },
    { id: 'seguranca', title: 'Políticas de Segurança', icon: '🔒', active: false }
  ]);

  readonly currentSection = signal<string>('anti-deepfake');

  selectSection(sectionId: string): void {
    this.sections.update(sections =>
      sections.map(section => ({
        ...section,
        active: section.id === sectionId
      }))
    );
    this.currentSection.set(sectionId);
    
    // Scroll suave até a seção
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

